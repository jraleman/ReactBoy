import type { StateReader, StateWriter } from '../state';
import { Channel } from './channel';

/** Right shift applied to 4-bit samples for NR32 output levels mute, 100%, 50% and 25%. */
const VOLUME_SHIFT = [4, 0, 1, 2] as const;

/** Channel 3: plays 32 4-bit samples from wave RAM (0xFF30-0xFF3F). */
export class Wave extends Channel {
  readonly ram = new Uint8Array(16);
  frequency = 0;
  volumeCode = 0;
  /** T-cycles until the next sample fetch. */
  private timer = 2048 * 2;
  private position = 0;
  /** The sample last read from wave RAM, which the DAC keeps outputting. */
  private sample = 0;
  /**
   * The channel read wave RAM on the last T-cycle of the current M-cycle, the moment a CPU
   * access in that M-cycle lands.
   */
  private readNow = false;

  constructor() {
    super(256);
  }

  advance(cycles: number): number {
    if (cycles > 0) this.readNow = false;
    if (!this.enabled) return 0;
    let sum = 0;
    while (cycles >= this.timer) {
      sum += this.timer * this.level();
      cycles -= this.timer;
      this.timer = (2048 - this.frequency) * 2;
      this.position = (this.position + 1) & 31;
      const byte = this.ram[this.position >> 1]!;
      this.sample = this.position & 1 ? byte & 0x0f : byte >> 4;
      // The APU always catches up to the end of an M-cycle.
      this.readNow = cycles === 0;
    }
    this.timer -= cycles;
    return sum + cycles * this.level();
  }

  private level(): number {
    return this.sample >> VOLUME_SHIFT[this.volumeCode]!;
  }

  /**
   * While the channel plays, the CPU reaches only the byte the channel is reading, and on a
   * DMG only in the cycle the channel reads it; other reads see 0xFF and writes are lost.
   */
  readRam(index: number): number {
    if (!this.enabled) return this.ram[index]!;
    return this.readNow ? this.ram[this.position >> 1]! : 0xff;
  }

  writeRam(index: number, value: number): void {
    if (!this.enabled) this.ram[index] = value;
    else if (this.readNow) this.ram[this.position >> 1] = value;
  }

  /** Powering the APU on clears the sample buffer. */
  resetSample(): void {
    this.sample = 0;
  }

  override powerOff(): void {
    super.powerOff();
    this.frequency = 0;
    this.volumeCode = 0;
  }

  /**
   * NR34. On a DMG, retriggering just as the channel fetches a byte (2 T-cycles after this
   * write) overwrites the start of wave RAM with that byte, or with its aligned 4 bytes.
   */
  override writeControl(value: number, lengthStepNext: boolean): void {
    if (value & 0x80 && this.enabled && this.timer === 2) {
      const next = ((this.position + 1) >> 1) & 0x0f;
      if (next < 4) this.ram[0] = this.ram[next]!;
      else this.ram.copyWithin(0, next & ~3, (next & ~3) + 4);
    }
    super.writeControl(value, lengthStepNext);
  }

  protected restart(): void {
    // The first sample is fetched a few cycles later than a full period.
    this.timer = (2048 - this.frequency) * 2 + 6;
    this.position = 0;
  }

  override writeState(w: StateWriter): void {
    super.writeState(w);
    w.bytes(this.ram);
    w.u16(this.frequency);
    w.u8(this.volumeCode);
    w.u16(this.timer);
    w.u8(this.position);
    w.u8(this.sample);
    w.bool(this.readNow);
  }

  override readState(r: StateReader): void {
    super.readState(r);
    r.bytes(this.ram);
    this.frequency = r.u16();
    this.volumeCode = r.u8();
    this.timer = r.u16();
    this.position = r.u8();
    this.sample = r.u8();
    this.readNow = r.bool();
  }
}
