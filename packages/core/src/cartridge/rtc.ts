import { CLOCK_HZ } from '../constants';
import type { StateReader, StateWriter, Stateful } from '../state';

/** Bytes of the clock block that VBA-M, BGB and mGBA append to MBC3 .sav files. */
export const RTC_FOOTER_SIZE = 48;
/** Older emulators store a 32-bit timestamp, making the block 4 bytes shorter. */
const RTC_FOOTER_SIZE_SHORT = 44;

/** Writable bits of S, M, H, DL, DH. */
const MASKS = [0x3f, 0x3f, 0x1f, 0xff, 0xc1] as const;
const HALT = 0x40;

/**
 * MBC3 real-time clock. While playing it runs on emulated time, so it stays deterministic
 * and pauses with the emulator; between sessions it catches up on wall-clock time from the
 * timestamps stored in battery saves and save states. Games read it through a latch.
 */
export class Rtc implements Stateful {
  /** S, M, H, DL, DH as the clock counts them. */
  private readonly live = new Uint8Array(5);
  /** The copy games read, refreshed by writing 0 then 1 to 0x6000-0x7FFF. */
  private readonly latched = new Uint8Array(5);
  private latchArmed = false;
  /** Emulated T-cycle up to which {@link live} has been advanced. */
  private cycles = 0;

  /** @param now total emulated T-cycles */
  constructor(private readonly now: () => number) {}

  writeLatch(value: number): void {
    if (value === 1 && this.latchArmed) {
      this.update();
      this.latched.set(this.live);
    }
    this.latchArmed = value === 0;
  }

  /** @param reg 0-4 for S, M, H, DL, DH */
  read(reg: number): number {
    return this.latched[reg] ?? 0xff;
  }

  write(reg: number, value: number): void {
    this.update();
    this.live[reg] = value & (MASKS[reg] ?? 0);
    // Writing the seconds register restarts the current second.
    if (reg === 0) this.cycles = this.now();
  }

  /** Advances the clock by real time that passed outside the emulator. */
  catchUp(seconds: number): void {
    this.update();
    this.addSeconds(Math.floor(seconds));
  }

  writeFooter(view: DataView, offset: number, wallMs: number): void {
    this.update();
    for (let i = 0; i < 5; i++) {
      view.setUint32(offset + i * 4, this.live[i]!, true);
      view.setUint32(offset + 20 + i * 4, this.latched[i]!, true);
    }
    const seconds = Math.floor(wallMs / 1000);
    view.setUint32(offset + 40, seconds >>> 0, true);
    view.setUint32(offset + 44, Math.floor(seconds / 2 ** 32), true);
  }

  /** Reads a footer written by {@link writeFooter} or another emulator; returns false if absent. */
  readFooter(view: DataView, offset: number, wallMs: number): boolean {
    const size = view.byteLength - offset;
    if (size < RTC_FOOTER_SIZE_SHORT) return false;
    for (let i = 0; i < 5; i++) {
      this.live[i] = view.getUint32(offset + i * 4, true) & MASKS[i]!;
      this.latched[i] = view.getUint32(offset + 20 + i * 4, true) & MASKS[i]!;
    }
    let saved = view.getUint32(offset + 40, true);
    if (size >= RTC_FOOTER_SIZE) saved += view.getUint32(offset + 44, true) * 2 ** 32;
    this.cycles = this.now();
    this.addSeconds(Math.max(0, Math.floor(wallMs / 1000) - saved));
    return true;
  }

  writeState(w: StateWriter): void {
    w.bytes(this.live);
    w.bytes(this.latched);
    w.bool(this.latchArmed);
    w.f64(this.cycles);
  }

  readState(r: StateReader): void {
    r.bytes(this.live);
    r.bytes(this.latched);
    this.latchArmed = r.bool();
    this.cycles = r.f64();
  }

  /** Brings {@link live} up to the current emulated time. */
  private update(): void {
    const now = this.now();
    if (this.live[4]! & HALT) {
      this.cycles = now;
      return;
    }
    const seconds = Math.floor((now - this.cycles) / CLOCK_HZ);
    if (seconds <= 0) return;
    this.cycles += seconds * CLOCK_HZ;
    this.addSeconds(seconds);
  }

  private addSeconds(n: number): void {
    const rtc = this.live;
    if (n <= 0 || rtc[4]! & HALT) return;
    const seconds = n + rtc[0]!;
    rtc[0] = seconds % 60;
    const minutes = Math.floor(seconds / 60) + rtc[1]!;
    rtc[1] = minutes % 60;
    const hours = Math.floor(minutes / 60) + rtc[2]!;
    rtc[2] = hours % 24;
    let days = Math.floor(hours / 24) + (rtc[3]! | ((rtc[4]! & 0x01) << 8));
    let carry = rtc[4]! & 0x80;
    if (days > 0x1ff) {
      carry = 0x80;
      days &= 0x1ff;
    }
    rtc[3] = days & 0xff;
    rtc[4] = (rtc[4]! & HALT) | carry | (days >> 8);
  }
}
