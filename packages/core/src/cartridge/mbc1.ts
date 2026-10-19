import { type Mbc, ramBankOffset, romBankOffset } from './mbc';

/** MBC1: up to 2 MiB ROM / 32 KiB RAM, with a mode bit that reuses the upper bank bits. */
export class Mbc1 implements Mbc {
  private ramEnabled = false;
  private bank1 = 1;
  private bank2 = 0;
  private mode = 0;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
  ) {}

  readRom(addr: number): number {
    const bank = addr < 0x4000 ? (this.mode ? this.bank2 << 5 : 0) : (this.bank2 << 5) | this.bank1;
    return this.rom[romBankOffset(this.rom, bank) + (addr & 0x3fff)] ?? 0xff;
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a;
    else if (addr < 0x4000) this.bank1 = value & 0x1f || 1;
    else if (addr < 0x6000) this.bank2 = value & 0x03;
    else this.mode = value & 0x01;
  }

  readRam(addr: number): number {
    if (!this.ramEnabled || this.ram.length === 0) return 0xff;
    return this.ram[this.ramOffset(addr)] ?? 0xff;
  }

  writeRam(addr: number, value: number): void {
    if (this.ramEnabled && this.ram.length > 0) this.ram[this.ramOffset(addr)] = value;
  }

  private ramOffset(addr: number): number {
    const offset = ramBankOffset(this.ram, this.mode ? this.bank2 : 0) + (addr & 0x1fff);
    return offset % this.ram.length;
  }
}
