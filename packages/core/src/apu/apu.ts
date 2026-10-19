import { CLOCK_HZ } from '../constants';
import type { StateReader, StateWriter, Stateful } from '../state';
import { Noise } from './noise';
import { Square } from './square';
import { Wave } from './wave';

/**
 * Bits that always read back as 1 for NR10-NR52 (0xFF10-0xFF26) and the unused
 * 0xFF27-0xFF2F, so games that read-modify-write sound registers behave correctly.
 */
const READ_MASKS = [
  0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xff, 0x00, 0x00, 0xbf, 0x00, 0x00, 0x70, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

/** Post-boot values for 0xFF10-0xFF25. */
const BOOT_VALUES = [
  0x80, 0xbf, 0xf3, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xff, 0x00, 0x00, 0xbf, 0x77, 0xf3,
];

// Register offsets from 0xFF10.
const NR10 = 0x00;
const NR11 = 0x01;
const NR12 = 0x02;
const NR13 = 0x03;
const NR14 = 0x04;
const NR21 = 0x06;
const NR22 = 0x07;
const NR23 = 0x08;
const NR24 = 0x09;
const NR30 = 0x0a;
const NR31 = 0x0b;
const NR32 = 0x0c;
const NR33 = 0x0d;
const NR34 = 0x0e;
const NR41 = 0x10;
const NR42 = 0x11;
const NR43 = 0x12;
const NR44 = 0x13;
const NR50 = 0x14;
const NR51 = 0x15;
const NR52 = 0x16;
const WAVE_RAM = 0x20;

/** Output buffer length in seconds; the host drains it every few frames. */
const BUFFER_SECONDS = 0.25;
/** How much the output capacitor discharges per T-cycle (DMG). */
const CAPACITOR_CHARGE = 0.999958;

/**
 * Audio processing unit: two square channels (the first with sweep), a wave channel and a
 * noise channel, sequenced at 512 Hz from DIV. With a sample rate set, the mix is averaged
 * over each sample period into interleaved stereo in [-1, 1].
 *
 * Channels run lazily: {@link tick} only counts cycles, and they catch up whenever something
 * can observe them — a register access, a frame sequencer step or a sample falling due.
 */
export class Apu implements Stateful {
  readonly square1 = new Square(true);
  readonly square2 = new Square(false);
  readonly wave = new Wave();
  readonly noise = new Noise();
  /** Bit n set = channel n+1 is heard (for muting channels individually). */
  channelMask = 0x0f;

  /** Last written values of NR10-NR51, for reading back. */
  private readonly regs = new Uint8Array(NR52);
  private powered = false;
  /** Next frame sequencer step, 0-7; even steps clock length counters. */
  private step = 0;
  /** T-cycles the channels have yet to catch up on. */
  private pending = 0;

  private sampleRate = 0;
  private samples = new Float32Array(0);
  private sampleCount = 0;
  /** T-cycles per output sample, and until the next one is due. */
  private samplePeriod = Infinity;
  private untilSample = Infinity;
  /** Output summed over the current sample period (level x T-cycles), and its length. */
  private sumLeft = 0;
  private sumRight = 0;
  private sumCount = 0;
  private capacitorLeft = 0;
  private capacitorRight = 0;
  private charge = 0;

  constructor() {
    this.write(0xff26, 0x80);
    BOOT_VALUES.forEach((value, i) => this.write(0xff10 + i, value));
    // The boot sound has finished: channel 1 is still on, but its envelope reached 0.
    this.square1.envelope.volume = 0;
  }

  /** @param addr 0xFF10-0xFF3F */
  read(addr: number): number {
    this.sync();
    const i = addr - 0xff10;
    if (i >= WAVE_RAM) return this.wave.readRam(i - WAVE_RAM);
    if (i === NR52) {
      return (
        (this.powered ? 0x80 : 0) |
        0x70 |
        (this.square1.enabled ? 0x01 : 0) |
        (this.square2.enabled ? 0x02 : 0) |
        (this.wave.enabled ? 0x04 : 0) |
        (this.noise.enabled ? 0x08 : 0)
      );
    }
    return (i < NR52 ? this.regs[i]! : 0) | READ_MASKS[i]!;
  }

  write(addr: number, value: number): void {
    this.sync();
    const i = addr - 0xff10;
    if (i >= WAVE_RAM) return this.wave.writeRam(i - WAVE_RAM, value);
    if (i === NR52) return this.setPower((value & 0x80) !== 0);
    if (i > NR52) return;
    if (!this.powered) {
      // On a DMG the length counters stay writable while the APU is off.
      if (i === NR11) this.square1.writeLength(value & 0x3f);
      else if (i === NR21) this.square2.writeLength(value & 0x3f);
      else if (i === NR31) this.wave.writeLength(value);
      else if (i === NR41) this.noise.writeLength(value & 0x3f);
      return;
    }
    this.regs[i] = value;
    const lengthStepNext = (this.step & 1) === 0;
    const { square1, square2, wave, noise } = this;
    switch (i) {
      case NR10:
        return square1.writeSweep(value);
      case NR11:
      case NR21: {
        const square = i === NR11 ? square1 : square2;
        square.duty = value >> 6;
        return square.writeLength(value & 0x3f);
      }
      case NR12:
      case NR22: {
        const square = i === NR12 ? square1 : square2;
        square.envelope.write(value);
        return square.setDac((value & 0xf8) !== 0);
      }
      case NR13:
      case NR23: {
        const square = i === NR13 ? square1 : square2;
        square.frequency = (square.frequency & 0x700) | value;
        return;
      }
      case NR14:
      case NR24: {
        const square = i === NR14 ? square1 : square2;
        square.frequency = (square.frequency & 0xff) | ((value & 0x07) << 8);
        return square.writeControl(value, lengthStepNext);
      }
      case NR30:
        return wave.setDac((value & 0x80) !== 0);
      case NR31:
        return wave.writeLength(value);
      case NR32:
        wave.volumeCode = (value >> 5) & 0x03;
        return;
      case NR33:
        wave.frequency = (wave.frequency & 0x700) | value;
        return;
      case NR34:
        wave.frequency = (wave.frequency & 0xff) | ((value & 0x07) << 8);
        return wave.writeControl(value, lengthStepNext);
      case NR41:
        return noise.writeLength(value & 0x3f);
      case NR42:
        noise.envelope.write(value);
        return noise.setDac((value & 0xf8) !== 0);
      case NR43:
        return noise.writePolynomial(value);
      case NR44:
        return noise.writeControl(value, lengthStepNext);
    }
  }

  /** Clocked at 512 Hz by a falling edge of DIV bit 4. */
  clockFrameSequencer(): void {
    if (!this.powered) return;
    this.sync();
    const step = this.step;
    this.step = (step + 1) & 7;
    if ((step & 1) === 0) {
      this.square1.clockLength();
      this.square2.clockLength();
      this.wave.clockLength();
      this.noise.clockLength();
    }
    if (step === 2 || step === 6) this.square1.clockSweep();
    if (step === 7) {
      this.square1.envelope.clock();
      this.square2.envelope.clock();
      this.noise.envelope.clock();
    }
  }

  /** Advances one M-cycle (4 T-cycles). */
  tick(): void {
    this.pending += 4;
    if ((this.untilSample -= 4) > 0) return;
    this.untilSample += this.samplePeriod;
    this.sync();
    this.emitSample();
  }

  /** Starts producing samples at `rate` Hz; 0 stops (the default, for headless runs). */
  setSampleRate(rate: number): void {
    rate = Math.max(0, Math.round(rate));
    if (rate === this.sampleRate) return;
    this.sync();
    this.sampleRate = rate;
    this.samples = new Float32Array(Math.ceil(this.sampleRate * BUFFER_SECONDS) * 2);
    this.sampleCount = 0;
    this.samplePeriod = this.untilSample = this.sampleRate ? CLOCK_HZ / this.sampleRate : Infinity;
    this.sumLeft = this.sumRight = this.sumCount = 0;
    this.capacitorLeft = this.capacitorRight = 0;
    this.charge = this.sampleRate ? CAPACITOR_CHARGE ** (CLOCK_HZ / this.sampleRate) : 0;
  }

  /**
   * Interleaved stereo samples produced since the last call. The view is reused: copy it
   * before running the emulator again.
   */
  takeSamples(): Float32Array {
    const out = this.samples.subarray(0, this.sampleCount * 2);
    this.sampleCount = 0;
    return out;
  }

  writeState(w: StateWriter): void {
    this.sync();
    w.bytes(this.regs);
    w.bool(this.powered);
    w.u8(this.step);
    this.square1.writeState(w);
    this.square2.writeState(w);
    this.wave.writeState(w);
    this.noise.writeState(w);
  }

  readState(r: StateReader): void {
    this.pending = 0;
    r.bytes(this.regs);
    this.powered = r.bool();
    this.step = r.u8();
    this.square1.readState(r);
    this.square2.readState(r);
    this.wave.readState(r);
    this.noise.readState(r);
  }

  private setPower(on: boolean): void {
    if (on === this.powered) return;
    this.powered = on;
    if (on) {
      // The sequencer restarts at step 0; duty and wave sample positions reset.
      this.step = 0;
      this.square1.resetDuty();
      this.square2.resetDuty();
      this.wave.resetSample();
    } else {
      this.regs.fill(0);
      this.square1.powerOff();
      this.square2.powerOff();
      this.wave.powerOff();
      this.noise.powerOff();
    }
  }

  /** Catches the channels up on pending cycles, adding their output to the current sample. */
  private sync(): void {
    const cycles = this.pending;
    if (cycles === 0) return;
    this.pending = 0;
    const s1 = this.square1.advance(cycles);
    const s2 = this.square2.advance(cycles);
    const s3 = this.wave.advance(cycles);
    const s4 = this.noise.advance(cycles);
    if (this.sampleRate === 0) return;
    this.sumCount += cycles;
    if (!this.powered) return;

    const panning = this.regs[NR51]!;
    const mask = this.channelMask & ((panning >> 4) | panning);
    let left = 0;
    let right = 0;
    if (mask & 0x01) {
      const v = this.analog(this.square1.dacEnabled, s1, cycles);
      if (panning & 0x10) left += v;
      if (panning & 0x01) right += v;
    }
    if (mask & 0x02) {
      const v = this.analog(this.square2.dacEnabled, s2, cycles);
      if (panning & 0x20) left += v;
      if (panning & 0x02) right += v;
    }
    if (mask & 0x04) {
      const v = this.analog(this.wave.dacEnabled, s3, cycles);
      if (panning & 0x40) left += v;
      if (panning & 0x04) right += v;
    }
    if (mask & 0x08) {
      const v = this.analog(this.noise.dacEnabled, s4, cycles);
      if (panning & 0x80) left += v;
      if (panning & 0x08) right += v;
    }
    const volume = this.regs[NR50]!;
    this.sumLeft += left * (((volume >> 4) & 0x07) + 1);
    this.sumRight += right * ((volume & 0x07) + 1);
  }

  /** A DAC maps digital 0-15 linearly onto [-1, 1]; this converts a summed level. */
  private analog(dacEnabled: boolean, sum: number, cycles: number): number {
    return dacEnabled ? sum / 7.5 - cycles : 0;
  }

  private emitSample(): void {
    // 4 channels at up to 8x master volume span [-32, 32].
    const scale = 1 / (32 * Math.max(1, this.sumCount));
    const left = this.sumLeft * scale;
    const right = this.sumRight * scale;
    this.sumLeft = this.sumRight = this.sumCount = 0;

    // The output capacitor blocks DC, so silent-but-on DACs settle back to 0.
    const outLeft = left - this.capacitorLeft;
    const outRight = right - this.capacitorRight;
    this.capacitorLeft = left - outLeft * this.charge;
    this.capacitorRight = right - outRight * this.charge;

    if (this.sampleCount * 2 >= this.samples.length) return; // nobody is draining: drop
    this.samples[this.sampleCount * 2] = outLeft;
    this.samples[this.sampleCount * 2 + 1] = outRight;
    this.sampleCount++;
  }
}
