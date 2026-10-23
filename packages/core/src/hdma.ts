import type { StateReader, StateWriter, Stateful } from './state';

/**
 * Game Boy Color VRAM DMA (HDMA1-HDMA5): copies 16-byte blocks from ROM or RAM into the
 * current VRAM bank, either all at once (general-purpose) or one block each HBlank. The CPU
 * waits while a block is copied; {@link GameBoy} runs the {@link pending} blocks between its
 * M-cycles.
 */
export class Hdma implements Stateful {
  /** Blocks to copy before the CPU's next M-cycle. */
  pending = 0;
  /** The source and destination counters, which HDMA1-HDMA4 set and copying advances. */
  private source = 0;
  private dest = 0;
  /** Blocks left minus 1, as HDMA5 reports them; 0x7F once done. */
  private length = 0x7f;
  private active = false;
  /** Copying one block per HBlank rather than all at once. */
  private hblank = false;

  /**
   * @param read reads the source as the CPU would
   * @param write writes VRAM (0x8000-0x9FFF) as the CPU would
   * @param inHblank whether STAT reads mode 0, as it also does with the LCD off
   */
  constructor(
    private readonly read: (addr: number) => number,
    private readonly write: (addr: number, value: number) => void,
    private readonly inHblank: () => boolean,
  ) {}

  /** HDMA1-HDMA4, which read back 0xFF. The low 4 bits of each address are ignored. */
  writeAddress(register: number, value: number): void {
    switch (register) {
      case 0:
        this.source = (value << 8) | (this.source & 0xff);
        break;
      case 1:
        this.source = (this.source & 0xff00) | (value & 0xf0);
        break;
      case 2:
        this.dest = ((value & 0x1f) << 8) | (this.dest & 0xff);
        break;
      case 3:
        this.dest = (this.dest & 0x1f00) | (value & 0xf0);
        break;
    }
  }

  /** HDMA5: bit 7 clear while a copy is under way, then set; 0xFF once one finishes. */
  readControl(): number {
    return (this.active ? 0 : 0x80) | this.length;
  }

  /**
   * Bit 7 picks HBlank or general-purpose DMA, the rest the length in blocks minus 1.
   * Clearing bit 7 during an HBlank DMA stops it instead, keeping the length left.
   */
  writeControl(value: number): void {
    if (this.active && this.hblank && (value & 0x80) === 0) {
      this.active = false;
      return;
    }
    this.length = value & 0x7f;
    this.active = true;
    this.hblank = (value & 0x80) !== 0;
    // An HBlank DMA started during mode 0 copies its first block straight away.
    if (!this.hblank) this.pending = this.length + 1;
    else if (this.inHblank()) this.pending = 1;
  }

  /** The PPU entered HBlank on a visible line while the CPU was running. */
  hblankStarted(): void {
    if (this.active && this.hblank) this.pending = 1;
  }

  /**
   * Copies the next block. A source in VRAM reads garbage, modelled as 0xFF; a destination
   * running past 0x9FFF ends the copy.
   */
  copyBlock(): void {
    this.pending--;
    for (let i = 0; i < 16; i++) {
      const from = (this.source + i) & 0xffff;
      const value = from >= 0x8000 && from < 0xa000 ? 0xff : this.read(from);
      this.write(0x8000 + this.dest + i, value);
    }
    this.source = (this.source + 16) & 0xffff;
    this.dest += 16;
    this.length = (this.length - 1) & 0x7f;
    if (this.length === 0x7f || this.dest === 0x2000) this.finish();
  }

  private finish(): void {
    this.active = false;
    this.length = 0x7f;
    this.dest &= 0x1ff0;
    this.pending = 0;
  }

  writeState(w: StateWriter): void {
    w.u8(this.pending);
    w.u16(this.source);
    w.u16(this.dest);
    w.u8(this.length);
    w.bool(this.active);
    w.bool(this.hblank);
  }

  readState(r: StateReader): void {
    this.pending = Math.min(r.u8(), 0x80);
    this.source = r.u16() & 0xfff0;
    this.dest = r.u16() & 0x1ff0;
    this.length = r.u8() & 0x7f;
    this.active = r.bool();
    this.hblank = r.bool();
  }
}
