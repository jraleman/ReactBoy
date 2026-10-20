import type { StateReader, StateWriter } from '../state';
import { type Mbc, ramBankOffset, romBankOffset } from './mbc';
import { Rtc } from './rtc';

/** MBC3: up to 2 MiB ROM / 32 KiB RAM plus an optional real-time clock. */
export class Mbc3 implements Mbc {
  readonly rtc: Rtc | undefined;
  private ramEnabled = false;
  romBank = 1;
  /** 0-3 selects a RAM bank, 0x08-0x0C an RTC register. */
  private select = 0;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
    hasRtc: boolean,
    /** Total emulated T-cycles, which drive the RTC. */
    now: () => number,
  ) {
    this.rtc = hasRtc ? new Rtc(now) : undefined;
  }

  readRom(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    return this.rom[romBankOffset(this.rom, this.romBank) + (addr & 0x3fff)] ?? 0xff;
  }

  writeRom(addr: number, value: number): void {
    if (addr < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
    } else if (addr < 0x4000) {
      this.romBank = value & 0x7f || 1;
    } else if (addr < 0x6000) {
      this.select = value;
    } else {
      this.rtc?.writeLatch(value);
    }
  }

  readRam(addr: number): number {
    if (!this.ramEnabled) return 0xff;
    if (this.select <= 0x03) {
      if (this.ram.length === 0) return 0xff;
      return this.ram[this.ramOffset(addr)] ?? 0xff;
    }
    if (this.rtc && this.select >= 0x08 && this.select <= 0x0c) {
      return this.rtc.read(this.select - 0x08);
    }
    return 0xff;
  }

  writeRam(addr: number, value: number): void {
    if (!this.ramEnabled) return;
    if (this.select <= 0x03) {
      if (this.ram.length > 0) this.ram[this.ramOffset(addr)] = value;
    } else if (this.rtc && this.select >= 0x08 && this.select <= 0x0c) {
      this.rtc.write(this.select - 0x08, value);
    }
  }

  writeState(w: StateWriter): void {
    w.bytes(this.ram);
    w.bool(this.ramEnabled);
    w.u8(this.romBank);
    w.u8(this.select);
    this.rtc?.writeState(w);
  }

  readState(r: StateReader): void {
    r.bytes(this.ram);
    this.ramEnabled = r.bool();
    this.romBank = r.u8();
    this.select = r.u8();
    this.rtc?.readState(r);
  }

  private ramOffset(addr: number): number {
    return (ramBankOffset(this.ram, this.select) + (addr & 0x1fff)) % this.ram.length;
  }
}
