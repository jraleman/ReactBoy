import { CLOCK_HZ } from '../constants';
import { type Mbc, ramBankOffset, romBankOffset } from './mbc';

/**
 * MBC3: up to 2 MiB ROM / 32 KiB RAM plus an optional real-time clock. The clock runs on
 * emulated time (so it stays deterministic and pauses with the emulator); it is read via
 * a latch, as on hardware.
 */
export class Mbc3 implements Mbc {
  private ramEnabled = false;
  private romBank = 1;
  /** 0-3 selects a RAM bank, 0x08-0x0C an RTC register. */
  private select = 0;
  private latchArmed = false;
  /** Live RTC: S, M, H, DL, DH. */
  private readonly rtc = new Uint8Array(5);
  private readonly latched = new Uint8Array(5);
  private rtcCycles = 0;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
    private readonly hasRtc: boolean,
    /** Total emulated T-cycles, used to advance the RTC lazily. */
    private readonly now: () => number,
  ) {}

  readRom(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    return this.rom[romBankOffset(this.rom, this.romBank) + (addr & 0x3fff)] ?? 0xff;
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
    } else if (addr < 0x4000) {
      this.romBank = value & 0x7f || 1;
    } else if (addr < 0x6000) {
      this.select = value;
    } else if (this.hasRtc) {
      if (value === 1 && this.latchArmed) {
        this.advanceRtc();
        this.latched.set(this.rtc);
      }
      this.latchArmed = value === 0;
    }
  }

  readRam(addr: number): number {
    if (!this.ramEnabled) return 0xff;
    if (this.select <= 0x03) {
      if (this.ram.length === 0) return 0xff;
      return this.ram[this.ramOffset(addr)] ?? 0xff;
    }
    if (this.hasRtc && this.select >= 0x08 && this.select <= 0x0c) {
      return this.latched[this.select - 0x08] ?? 0xff;
    }
    return 0xff;
  }

  writeRam(addr: number, value: number): void {
    if (!this.ramEnabled) return;
    if (this.select <= 0x03) {
      if (this.ram.length > 0) this.ram[this.ramOffset(addr)] = value;
    } else if (this.hasRtc && this.select >= 0x08 && this.select <= 0x0c) {
      this.advanceRtc();
      this.rtc[this.select - 0x08] = value;
      if (this.select === 0x08) this.rtcCycles = this.now();
    }
  }

  private ramOffset(addr: number): number {
    return (ramBankOffset(this.ram, this.select) + (addr & 0x1fff)) % this.ram.length;
  }

  private advanceRtc(): void {
    const now = this.now();
    const halted = (this.rtc[4]! & 0x40) !== 0;
    let seconds = Math.floor((now - this.rtcCycles) / CLOCK_HZ);
    this.rtcCycles += seconds * CLOCK_HZ;
    if (halted || seconds <= 0) {
      if (halted) this.rtcCycles = now;
      return;
    }
    const rtc = this.rtc;
    seconds += rtc[0]!;
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
    rtc[4] = (rtc[4]! & 0x40) | carry | (days >> 8);
  }
}
