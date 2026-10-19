/** OAM DMA (0xFF46): copies 160 bytes from XX00 into OAM, one byte per M-cycle. */
export class OamDma {
  register = 0xff;
  active = false;
  private source = 0;
  private index = 0;
  private startDelay = 0;

  constructor(
    private readonly read: (addr: number) => number,
    private readonly oam: Uint8Array,
  ) {}

  start(value: number): void {
    this.register = value;
    // Sources above 0xDFFF read from the echo of work RAM.
    this.source = (value >= 0xe0 ? value - 0x20 : value) << 8;
    this.index = 0;
    this.startDelay = 1;
  }

  tick(): void {
    if (this.startDelay > 0) {
      if (--this.startDelay === 0) this.active = true;
      return;
    }
    if (!this.active) return;
    this.oam[this.index] = this.read(this.source + this.index);
    if (++this.index === this.oam.length) this.active = false;
  }
}
