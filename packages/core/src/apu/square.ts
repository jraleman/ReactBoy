import type { StateReader, StateWriter } from '../state';
import { Channel, Envelope } from './channel';

/** 12.5%, 25%, 50% and 75% duty waveforms, one bit per step (step 0 = bit 0). */
const DUTY = [0b1000_0000, 0b1000_0001, 0b1110_0001, 0b0111_1110] as const;

/** Channels 1 and 2: a pulse wave with a volume envelope; channel 1 adds frequency sweep. */
export class Square extends Channel {
  readonly envelope = new Envelope();
  /** 11-bit period value from NRx3/NRx4; the tone is 131072 / (2048 - frequency) Hz. */
  frequency = 0;
  duty = 0;
  /** T-cycles until the next waveform step. */
  private timer = 2048 * 4;
  private step = 0;

  // NR10 sweep, channel 1 only.
  private sweepPeriod = 0;
  private sweepNegate = false;
  private sweepShift = 0;
  private sweepTimer = 0;
  private sweepEnabled = false;
  private shadow = 0;
  /** A negate-mode calculation happened since the last trigger. */
  private negateUsed = false;

  constructor(private readonly hasSweep: boolean) {
    super(64);
  }

  advance(cycles: number): number {
    if (!this.enabled) return 0;
    if (this.envelope.volume === 0) {
      // Silent: skip ahead without walking every step (the post-boot channel 1 sits at the
      // highest frequency, which would otherwise step every M-cycle).
      if (cycles >= this.timer) {
        const period = (2048 - this.frequency) * 4;
        const extra = cycles - this.timer;
        this.step = (this.step + 1 + Math.floor(extra / period)) & 7;
        this.timer = period - (extra % period);
      } else {
        this.timer -= cycles;
      }
      return 0;
    }
    let sum = 0;
    while (cycles >= this.timer) {
      sum += this.timer * this.level();
      cycles -= this.timer;
      this.timer = (2048 - this.frequency) * 4;
      this.step = (this.step + 1) & 7;
    }
    this.timer -= cycles;
    return sum + cycles * this.level();
  }

  protected level(): number {
    return (DUTY[this.duty]! >> this.step) & 1 ? this.envelope.volume : 0;
  }

  writeSweep(value: number): void {
    const negate = (value & 0x08) !== 0;
    // Leaving negate mode after using it since the last trigger disables the channel.
    if (this.sweepNegate && !negate && this.negateUsed) this.enabled = false;
    this.sweepPeriod = (value >> 4) & 0x07;
    this.sweepNegate = negate;
    this.sweepShift = value & 0x07;
  }

  /** Clocked at 128 Hz by frame sequencer steps 2 and 6. */
  clockSweep(): void {
    if (--this.sweepTimer > 0) return;
    this.sweepTimer = this.sweepPeriod || 8;
    if (!this.sweepEnabled || this.sweepPeriod === 0) return;
    const next = this.sweepTarget();
    if (next <= 2047 && this.sweepShift !== 0) {
      this.shadow = next;
      this.frequency = next;
      // The new frequency is checked for overflow again, but not applied.
      this.sweepTarget();
    }
  }

  /** Resets the waveform to its first step, as powering the APU on does. */
  resetDuty(): void {
    this.step = 0;
  }

  override powerOff(clearLength: boolean): void {
    super.powerOff(clearLength);
    this.envelope.write(0);
    this.frequency = 0;
    this.duty = 0;
    this.writeSweep(0);
  }

  protected restart(): void {
    this.timer = (2048 - this.frequency) * 4;
    this.envelope.trigger();
    if (!this.hasSweep) return;
    this.shadow = this.frequency;
    this.sweepTimer = this.sweepPeriod || 8;
    this.sweepEnabled = this.sweepPeriod !== 0 || this.sweepShift !== 0;
    this.negateUsed = false;
    if (this.sweepShift !== 0) this.sweepTarget();
  }

  /** The next swept frequency; disables the channel if it overflows 11 bits. */
  private sweepTarget(): number {
    const delta = this.shadow >> this.sweepShift;
    let next = this.shadow + delta;
    if (this.sweepNegate) {
      next = this.shadow - delta;
      this.negateUsed = true;
    }
    if (next > 2047) this.enabled = false;
    return next;
  }

  override writeState(w: StateWriter): void {
    super.writeState(w);
    this.envelope.writeState(w);
    w.u16(this.frequency);
    w.u8(this.duty);
    w.u16(this.timer);
    w.u8(this.step);
    w.u8(this.sweepPeriod);
    w.bool(this.sweepNegate);
    w.u8(this.sweepShift);
    w.u8(this.sweepTimer);
    w.bool(this.sweepEnabled);
    w.u16(this.shadow);
    w.bool(this.negateUsed);
  }

  override readState(r: StateReader): void {
    super.readState(r);
    this.envelope.readState(r);
    this.frequency = r.u16();
    this.duty = r.u8();
    this.timer = r.u16();
    this.step = r.u8();
    this.sweepPeriod = r.u8();
    this.sweepNegate = r.bool();
    this.sweepShift = r.u8();
    this.sweepTimer = r.u8();
    this.sweepEnabled = r.bool();
    this.shadow = r.u16();
    this.negateUsed = r.bool();
  }
}
