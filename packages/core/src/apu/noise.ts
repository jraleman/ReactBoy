import type { StateReader, StateWriter } from '../state';
import { Channel, Envelope } from './channel';

/** NR43 divisor codes 0-7, in T-cycles. */
const DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112] as const;

/** Channel 4: pseudo-random noise from a 15-bit (or 7-bit) linear-feedback shift register. */
export class Noise extends Channel {
  readonly envelope = new Envelope();
  private clockShift = 0;
  private narrow = false;
  private divisor = 0;
  /** T-cycles until the next LFSR shift. */
  private timer: number = DIVISORS[0];
  private lfsr = 0x7fff;

  constructor() {
    super(64);
  }

  /** NR43. */
  writePolynomial(value: number): void {
    this.clockShift = value >> 4;
    this.narrow = (value & 0x08) !== 0;
    this.divisor = value & 0x07;
  }

  advance(cycles: number): number {
    if (!this.enabled) return 0;
    let sum = 0;
    while (cycles >= this.timer) {
      sum += this.timer * this.level();
      cycles -= this.timer;
      this.timer = this.period();
      // Shifts 14 and 15 stop the LFSR.
      if (this.clockShift >= 14) continue;
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr = (this.lfsr >> 1) | (bit << 14);
      if (this.narrow) this.lfsr = (this.lfsr & ~0x40) | (bit << 6);
    }
    this.timer -= cycles;
    return sum + cycles * this.level();
  }

  private level(): number {
    return this.lfsr & 1 ? 0 : this.envelope.volume;
  }

  override powerOff(): void {
    super.powerOff();
    this.envelope.write(0);
    this.writePolynomial(0);
  }

  protected restart(): void {
    this.lfsr = 0x7fff;
    this.timer = this.period();
    this.envelope.trigger();
  }

  private period(): number {
    return DIVISORS[this.divisor]! << this.clockShift;
  }

  override writeState(w: StateWriter): void {
    super.writeState(w);
    this.envelope.writeState(w);
    w.u8(this.clockShift);
    w.bool(this.narrow);
    w.u8(this.divisor);
    w.u32(this.timer);
    w.u16(this.lfsr);
  }

  override readState(r: StateReader): void {
    super.readState(r);
    this.envelope.readState(r);
    this.clockShift = r.u8();
    this.narrow = r.bool();
    this.divisor = r.u8();
    this.timer = r.u32();
    this.lfsr = r.u16();
  }
}
