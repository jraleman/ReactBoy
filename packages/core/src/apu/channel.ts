import type { StateReader, StateWriter, Stateful } from '../state';

/**
 * What all four channels share: the on/off status reported in NR52, the DAC, and the length
 * counter with its trigger-time quirks.
 */
export abstract class Channel implements Stateful {
  enabled = false;
  dacEnabled = false;
  lengthEnabled = false;
  /** Counts down at 256 Hz while enabled; reaching 0 silences the channel. */
  length = 0;

  /** @param maxLength 64, or 256 for the wave channel */
  constructor(private readonly maxLength: number) {}

  /**
   * Runs the frequency timer for `cycles` T-cycles and returns the digital output (0-15)
   * summed over them, which the mixer turns into an average. Disabled channels stand still:
   * a trigger reloads their timers anyway.
   */
  abstract advance(cycles: number): number;
  /** Channel-specific restart on trigger. */
  protected abstract restart(): void;
  /** The digital output (0-15) right now, ignoring whether the channel is on. */
  protected abstract level(): number;

  /** The digital output (0-15) right now, as a Game Boy Color's PCM12 and PCM34 show it. */
  output(): number {
    return this.enabled ? this.level() : 0;
  }

  writeLength(value: number): void {
    this.length = this.maxLength - value;
  }

  setDac(on: boolean): void {
    this.dacEnabled = on;
    if (!on) this.enabled = false;
  }

  /**
   * NRx4 bits 6 (length enable) and 7 (trigger).
   * @param lengthStepNext the frame sequencer's next step clocks length counters
   */
  writeControl(value: number, lengthStepNext: boolean): void {
    const trigger = (value & 0x80) !== 0;
    const wasEnabled = this.lengthEnabled;
    this.lengthEnabled = (value & 0x40) !== 0;
    // Enabling length in the half of the period that won't clock it clocks it once now.
    if (!lengthStepNext && !wasEnabled && this.lengthEnabled && this.length > 0) {
      if (--this.length === 0 && !trigger) this.enabled = false;
    }
    if (!trigger) return;
    this.enabled = this.dacEnabled;
    if (this.length === 0) {
      this.length = this.maxLength;
      if (this.lengthEnabled && !lengthStepNext) this.length--;
    }
    this.restart();
  }

  clockLength(): void {
    if (this.lengthEnabled && this.length > 0 && --this.length === 0) this.enabled = false;
  }

  /**
   * Clears every register-driven setting. On a DMG the length counter survives power-off;
   * a Game Boy Color clears it too.
   */
  powerOff(clearLength: boolean): void {
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthEnabled = false;
    if (clearLength) this.length = 0;
  }

  writeState(w: StateWriter): void {
    w.bool(this.enabled);
    w.bool(this.dacEnabled);
    w.bool(this.lengthEnabled);
    w.u16(this.length);
  }

  readState(r: StateReader): void {
    this.enabled = r.bool();
    this.dacEnabled = r.bool();
    this.lengthEnabled = r.bool();
    this.length = r.u16();
  }
}

/** Volume envelope of the square and noise channels (NRx2), clocked at 64 Hz. */
export class Envelope implements Stateful {
  volume = 0;
  private initial = 0;
  private increase = false;
  private period = 0;
  private timer = 0;

  write(value: number): void {
    this.initial = value >> 4;
    this.increase = (value & 0x08) !== 0;
    this.period = value & 0x07;
  }

  trigger(): void {
    this.volume = this.initial;
    // Like the sweep timer, the envelope timer treats a period of 0 as 8.
    this.timer = this.period || 8;
  }

  clock(): void {
    if (this.period === 0 || --this.timer > 0) return;
    this.timer = this.period;
    if (this.increase) {
      if (this.volume < 15) this.volume++;
    } else if (this.volume > 0) {
      this.volume--;
    }
  }

  writeState(w: StateWriter): void {
    w.u8(this.volume);
    w.u8(this.initial);
    w.bool(this.increase);
    w.u8(this.period);
    w.u8(this.timer);
  }

  readState(r: StateReader): void {
    this.volume = r.u8();
    this.initial = r.u8();
    this.increase = r.bool();
    this.period = r.u8();
    this.timer = r.u8();
  }
}
