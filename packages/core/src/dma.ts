import type { StateReader, StateWriter, Stateful } from './state';

/** OAM DMA (0xFF46): copies 160 bytes from XX00 into OAM, one byte per M-cycle. */
export class OamDma implements Stateful {
  register = 0xff;
  active = false;
  private source = 0;
  private index = 0;
  private startDelay = 0;

  constructor(
    private readonly read: (addr: number) => number,
    private readonly oam: Uint8Array,
  ) {}

  /**
   * After the write there is one M-cycle of setup, then one byte is copied per M-cycle. OAM
   * is blocked from the first copy through the M-cycle after the last. A restart keeps it
   * blocked through the new setup cycle.
   */
  start(value: number): void {
    this.register = value;
    // Sources above 0xDFFF read from the echo of work RAM.
    this.source = (value >= 0xe0 ? value - 0x20 : value) << 8;
    this.index = 0;
    this.startDelay = 2;
  }

  tick(): void {
    if (this.startDelay > 0) {
      if (--this.startDelay > 0) return;
      this.active = true;
    } else if (!this.active) return;
    if (this.index === this.oam.length) {
      this.active = false;
      return;
    }
    this.oam[this.index] = this.read(this.source + this.index);
    this.index++;
  }

  writeState(w: StateWriter): void {
    w.u8(this.register);
    w.bool(this.active);
    w.u16(this.source);
    w.u8(this.index);
    w.u8(this.startDelay);
  }

  readState(r: StateReader): void {
    this.register = r.u8();
    this.active = r.bool();
    this.source = r.u16();
    this.index = r.u8();
    this.startDelay = r.u8();
  }
}
