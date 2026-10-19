/**
 * Bits that always read back as 1 for NR10-NR52 (0xFF10-0xFF26) and the unused
 * 0xFF27-0xFF2F, so games that read-modify-write sound registers behave correctly.
 */
const READ_MASKS = [
  0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xff, 0x00, 0x00, 0xbf, 0x00, 0x00, 0x70, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

/** Post-boot values for 0xFF10-0xFF26. */
const BOOT_VALUES = [
  0x80, 0xbf, 0xf3, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xff, 0x00, 0x00, 0xbf, 0x77, 0xf3, 0xf1,
];

const NR52 = 0x16;
const WAVE_RAM = 0x20;

/**
 * Sound registers and wave RAM. Sound generation (channels, frame sequencer, mixer) arrives
 * with the AudioWorklet milestone; until then the machine runs silently.
 */
export class Apu {
  private readonly regs = new Uint8Array(0x30);

  constructor() {
    this.regs.set(BOOT_VALUES);
  }

  private get powered(): boolean {
    return (this.regs[NR52]! & 0x80) !== 0;
  }

  /** @param addr 0xFF10-0xFF3F */
  read(addr: number): number {
    const i = addr - 0xff10;
    if (i >= WAVE_RAM) return this.regs[i]!;
    // No channel is ever playing yet, so NR52's status bits read 0.
    if (i === NR52) return (this.regs[NR52]! & 0x80) | 0x70;
    return this.regs[i]! | READ_MASKS[i]!;
  }

  write(addr: number, value: number): void {
    const i = addr - 0xff10;
    if (i >= WAVE_RAM) {
      this.regs[i] = value;
    } else if (i === NR52) {
      if ((value & 0x80) === 0) this.regs.fill(0, 0, NR52);
      this.regs[NR52] = value & 0x80;
    } else if (this.powered) {
      this.regs[i] = value;
    }
  }
}
