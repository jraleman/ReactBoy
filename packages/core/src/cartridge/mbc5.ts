import type { StateReader, StateWriter } from '../state';
import { type Mbc, ramBankOffset, romBankOffset } from './mbc';

/** MBC5: up to 8 MiB ROM (9-bit bank number) / 128 KiB RAM. */
export class Mbc5 implements Mbc {
  private ramEnabled = false;
  romBank = 1;
  private ramBank = 0;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
    /** On rumble carts bit 3 of the RAM bank drives the motor instead of selecting RAM. */
    private readonly hasRumble: boolean,
  ) {}

  readRom(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    return this.rom[romBankOffset(this.rom, this.romBank) + (addr & 0x3fff)] ?? 0xff;
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) this.ramEnabled = (value & 0x0f) === 0x0a;
    else if (addr < 0x3000) this.romBank = (this.romBank & 0x100) | value;
    else if (addr < 0x4000) this.romBank = (this.romBank & 0xff) | ((value & 0x01) << 8);
    else if (addr < 0x6000) this.ramBank = value & (this.hasRumble ? 0x07 : 0x0f);
  }

  readRam(addr: number): number {
    if (!this.ramEnabled || this.ram.length === 0) return 0xff;
    return this.ram[this.ramOffset(addr)] ?? 0xff;
  }

  writeRam(addr: number, value: number): void {
    if (this.ramEnabled && this.ram.length > 0) this.ram[this.ramOffset(addr)] = value;
  }

  writeState(w: StateWriter): void {
    w.bytes(this.ram);
    w.bool(this.ramEnabled);
    w.u16(this.romBank);
    w.u8(this.ramBank);
  }

  readState(r: StateReader): void {
    r.bytes(this.ram);
    this.ramEnabled = r.bool();
    this.romBank = r.u16();
    this.ramBank = r.u8();
  }

  private ramOffset(addr: number): number {
    return (ramBankOffset(this.ram, this.ramBank) + (addr & 0x1fff)) % this.ram.length;
  }
}
