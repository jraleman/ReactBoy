import { Interrupt, type Interrupts } from './interrupts';
import type { StateReader, StateWriter, Stateful } from './state';

/**
 * Counter bit (DIV bit 4) whose falling edge clocks the APU frame sequencer. In double speed
 * it is the next bit up, so the sequencer keeps to 512 Hz.
 */
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
  counter = 0xabc8;
  tima = 0;
  tma = 0;
  tac = 0xf8;
  /** M-cycles left before an overflowed TIMA is reloaded (A), and the reload cycle itself (B). */
  private overflowDelay = 0;
  private reloading = false;
  private apuBit = DIV_APU_BIT;

  constructor(
    private readonly interrupts: Interrupts,
    /** Called on each falling edge of DIV bit 4, or 5 in double speed (512 Hz). */
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
    if (counter & ~this.counter & this.apuBit) this.clockApu();
  }

  /** A Game Boy Color's CPU speed, which the timer runs at. */
  setDoubleSpeed(double: boolean): void {
    this.apuBit = double ? DIV_APU_BIT << 1 : DIV_APU_BIT;
  }

  readDiv(): number {
    return this.counter >> 8;
  }

  writeDiv(): void {
    const before = this.signal();
    const counter = this.counter;
    this.counter = 0;
    if (before) this.incrementTima();
    if (counter & this.apuBit) this.clockApu();
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

  /**
   * The write lands before the counter advances in its M-cycle, but {@link tick} has already
   * run with the old TAC. So TIMA counts the falling edge that the correct order would give
   * (on the switch itself, or on that advance under the new setting) unless tick() already
   * did. Outside the M-cycle where the selected bit falls, this is just the switch's edge.
   */
  writeTac(value: number): void {
    const prev = (this.counter - 4) & 0xffff;
    const oldPrev = this.signal(this.tac, prev);
    const counted = oldPrev && !this.signal();
    this.tac = value & 0x07;
    const newPrev = this.signal(this.tac, prev);
    const edge = newPrev ? !this.signal() : oldPrev;
    if (edge && !counted) this.incrementTima();
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

  private signal(tac = this.tac, counter = this.counter): boolean {
    return (tac & 0x04) !== 0 && (counter & TAC_BITS[tac & 3]!) !== 0;
  }

  private incrementTima(): void {
    this.tima = (this.tima + 1) & 0xff;
    if (this.tima === 0) this.overflowDelay = 1;
  }
}
