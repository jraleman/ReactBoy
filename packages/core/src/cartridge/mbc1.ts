import type { StateReader, StateWriter } from '../state';
import { type Mbc, ramBankOffset, romBankOffset } from './mbc';

/** Size of an MBC1 multicart, and where its second game's header logo is. */
const MULTICART_SIZE = 0x100000;
const SECOND_GAME_LOGO = 0x40104;
// prettier-ignore
export const NINTENDO_LOGO = [
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83,
  0x00, 0x0c, 0x00, 0x0d, 0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e,
  0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99, 0xbb, 0xbb, 0x67, 0x63,
  0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
];

/**
 * MBC1 multicarts (MBC1M) wire BANK2 one bit lower, so each 256 KiB game sees 16 banks. The
 * header doesn't say so; like other emulators, detect a 1 MiB ROM whose second game also
 * carries the Nintendo logo.
 */
function isMulticart(rom: Uint8Array): boolean {
  return (
    rom.length === MULTICART_SIZE &&
    NINTENDO_LOGO.every((byte, i) => rom[SECOND_GAME_LOGO + i] === byte)
  );
}

/** MBC1: up to 2 MiB ROM / 32 KiB RAM, with a mode bit that reuses the upper bank bits. */
export class Mbc1 implements Mbc {
  private ramEnabled = false;
  private bank1 = 1;
  private bank2 = 0;
  private mode = 0;
  /** Where BANK2 lands in the ROM bank number: 5, or 4 on a multicart. */
  private readonly bank2Shift: number;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
  ) {
    this.bank2Shift = isMulticart(rom) ? 4 : 5;
  }

  get romBank(): number {
    return this.highBank() | (this.bank1 & ((1 << this.bank2Shift) - 1));
  }

  readRom(addr: number): number {
    const bank = addr < 0x4000 ? (this.mode ? this.highBank() : 0) : this.romBank;
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

  writeState(w: StateWriter): void {
    w.bytes(this.ram);
    w.bool(this.ramEnabled);
    w.u8(this.bank1);
    w.u8(this.bank2);
    w.u8(this.mode);
  }

  readState(r: StateReader): void {
    r.bytes(this.ram);
    this.ramEnabled = r.bool();
    this.bank1 = r.u8();
    this.bank2 = r.u8();
    this.mode = r.u8();
  }

  private highBank(): number {
    return this.bank2 << this.bank2Shift;
  }

  private ramOffset(addr: number): number {
    const offset = ramBankOffset(this.ram, this.mode ? this.bank2 : 0) + (addr & 0x1fff);
    return offset % this.ram.length;
  }
}
