import { Interrupt, type Interrupts } from './interrupts';

/** Bit of the internal counter whose falling edge clocks TIMA, indexed by TAC & 3. */
const TAC_BITS = [1 << 9, 1 << 3, 1 << 5, 1 << 7] as const;

/**
 * DIV/TIMA/TMA/TAC. DIV is the upper byte of a 16-bit counter that advances every
 * T-cycle; TIMA is clocked by a falling edge on one of its bits, which is why writes to
 * DIV and TAC can bump TIMA.
 */
export class Timer {
  /** Internal 16-bit counter; post-boot value on a DMG. */
  counter = 0xabcc;
  tima = 0;
  tma = 0;
  tac = 0xf8;
  /** M-cycles left before an overflowed TIMA is reloaded (A), and the reload cycle itself (B). */
  private overflowDelay = 0;
  private reloading = false;

  constructor(private readonly interrupts: Interrupts) {}

  /** Advances one M-cycle (4 T-cycles). */
  tick(): void {
    this.reloading = false;
    if (this.overflowDelay > 0 && --this.overflowDelay === 0) {
      this.tima = this.tma;
      this.reloading = true;
      this.interrupts.request(Interrupt.Timer);
    }
    const before = this.signal();
    this.counter = (this.counter + 4) & 0xffff;
    if (before && !this.signal()) this.incrementTima();
  }

  readDiv(): number {
    return this.counter >> 8;
  }

  writeDiv(): void {
    const before = this.signal();
    this.counter = 0;
    if (before) this.incrementTima();
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

  private signal(): boolean {
    return (this.tac & 0x04) !== 0 && (this.counter & TAC_BITS[this.tac & 3]!) !== 0;
  }

  private incrementTima(): void {
    this.tima = (this.tima + 1) & 0xff;
    if (this.tima === 0) this.overflowDelay = 1;
  }
}
