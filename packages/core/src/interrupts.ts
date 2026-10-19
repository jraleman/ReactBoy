import type { StateReader, StateWriter, Stateful } from './state';

/** Interrupt bits in IE/IF, in priority order (lowest bit wins). */
export const Interrupt = {
  VBlank: 0x01,
  Stat: 0x02,
  Timer: 0x04,
  Serial: 0x08,
  Joypad: 0x10,
} as const;

export type InterruptBit = (typeof Interrupt)[keyof typeof Interrupt];

/** The IE (0xFFFF) and IF (0xFF0F) registers. */
export class Interrupts implements Stateful {
  enable = 0x00;
  flags = 0xe1;

  request(bit: InterruptBit): void {
    this.flags |= bit;
  }

  /** Interrupts that are both requested and enabled. */
  pending(): number {
    return this.enable & this.flags & 0x1f;
  }

  readFlags(): number {
    // The top three bits of IF are unused and read back as 1.
    return this.flags | 0xe0;
  }

  writeFlags(value: number): void {
    this.flags = value & 0x1f;
  }

  writeState(w: StateWriter): void {
    w.u8(this.enable);
    w.u8(this.flags);
  }

  readState(r: StateReader): void {
    this.enable = r.u8();
    this.flags = r.u8();
  }
}
