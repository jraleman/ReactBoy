import { Interrupt, type Interrupts } from './interrupts';
import type { StateReader, StateWriter, Stateful } from './state';

/** Counter bit (DIV bit 4) whose falling edge clocks the APU frame sequencer. */
const DIV_APU_BIT = 1 << 12;

/** Bit of the internal counter whose falling edge clocks TIMA, indexed by TAC & 3. */
const TAC_BITS = [1 << 9, 1 << 3, 1 << 5, 1 << 7] as const;

/**
 * DIV/TIMA/TMA/TAC. DIV is the upper byte of a 16-bit counter that advances every
 * T-cycle; TIMA is clocked by a falling edge on one of its bits, which is why writes to
 * DIV and TAC can bump TIMA. The APU's frame sequencer hangs off another bit the same way.
 */
export class Timer implements Stateful {
  /** Internal 16-bit counter; post-boot value on a DMG. */
  counter = 0xabcc;
  tima = 0;
  tma = 0;
  tac = 0xf8;
  /** M-cycles left before an overflowed TIMA is reloaded (A), and the reload cycle itself (B). */
  private overflowDelay = 0;
  private reloading = false;

  constructor(
    private readonly interrupts: Interrupts,
    /** Called on each falling edge of DIV bit 4 (512 Hz). */
    private readonly clockApu: () => void = () => {},
  ) {}

  /** Advances one M-cycle (4 T-cycles). */
  tick(): void {
    this.reloading = false;
    if (this.overflowDelay > 0 && --this.overflowDelay === 0) {
      this.tima = this.tma;
      this.reloading = true;
      this.interrupts.request(Interrupt.Timer);
    }
    const before = this.signal();
    const counter = this.counter;
    this.counter = (counter + 4) & 0xffff;
    if (before && !this.signal()) this.incrementTima();
    if (counter & ~this.counter & DIV_APU_BIT) this.clockApu();
  }

  readDiv(): number {
    return this.counter >> 8;
  }

  writeDiv(): void {
    const before = this.signal();
    const counter = this.counter;
    this.counter = 0;
    if (before) this.incrementTima();
    if (counter & DIV_APU_BIT) this.clockApu();
  }

  writeTima(value: number): void {
    // Writing during the reload cycle is ignored; writing just before it cancels the reload.
    if (this.reloading) return;
    this.overflowDelay = 0;
    this.tima = value;
  }

  writeTma(value: number): void {
    this.tma = value;
    if (this.reloading) this.tima = value;
  }

  readTac(): number {
    return this.tac | 0xf8;
  }

  writeTac(value: number): void {
    const before = this.signal();
    this.tac = value & 0x07;
    if (before && !this.signal()) this.incrementTima();
  }

  writeState(w: StateWriter): void {
    w.u16(this.counter);
    w.u8(this.tima);
    w.u8(this.tma);
    w.u8(this.tac);
    w.u8(this.overflowDelay);
    w.bool(this.reloading);
  }

  readState(r: StateReader): void {
    this.counter = r.u16();
    this.tima = r.u8();
    this.tma = r.u8();
    this.tac = r.u8();
    this.overflowDelay = r.u8();
    this.reloading = r.bool();
  }

  private signal(): boolean {
    return (this.tac & 0x04) !== 0 && (this.counter & TAC_BITS[this.tac & 3]!) !== 0;
  }

  private incrementTima(): void {
    this.tima = (this.tima + 1) & 0xff;
    if (this.tima === 0) this.overflowDelay = 1;
  }
}
