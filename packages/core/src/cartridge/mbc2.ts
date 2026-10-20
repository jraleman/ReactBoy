import type { StateReader, StateWriter } from '../state';
import { type Mbc, romBankOffset } from './mbc';

/** MBC2: up to 256 KiB ROM and 512 x 4-bit built-in RAM. Bit 8 of the address picks the register. */
export class Mbc2 implements Mbc {
  private ramEnabled = false;
  private bank = 1;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
  ) {}

  get romBank(): number {
    return this.bank;
  }

  readRom(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    return this.rom[romBankOffset(this.rom, this.bank) + (addr & 0x3fff)] ?? 0xff;
  }

  writeRom(addr: number, value: number): void {
    if (addr >= 0x4000) return;
    if (addr & 0x100) this.bank = value & 0x0f || 1;
    else this.ramEnabled = (value & 0x0f) === 0x0a;
  }

  readRam(addr: number): number {
    if (!this.ramEnabled) return 0xff;
    return 0xf0 | (this.ram[addr & 0x1ff] ?? 0x0f);
  }

  writeRam(addr: number, value: number): void {
    if (this.ramEnabled) this.ram[addr & 0x1ff] = value & 0x0f;
  }

  writeState(w: StateWriter): void {
    w.bytes(this.ram);
    w.bool(this.ramEnabled);
    w.u8(this.bank);
  }

  readState(r: StateReader): void {
    r.bytes(this.ram);
    this.ramEnabled = r.bool();
    this.bank = r.u8();
  }
}
