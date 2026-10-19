import type { StateReader, StateWriter } from '../state';
import type { Mbc } from './mbc';

/** ROM-only cartridges, optionally with up to 8 KiB of unbanked RAM. */
export class Mbc0 implements Mbc {
  readonly romBank = 1;

  constructor(
    private readonly rom: Uint8Array,
    readonly ram: Uint8Array,
  ) {}

  readRom(addr: number): number {
    return this.rom[addr] ?? 0xff;
  }

  writeRom(): void {}

  readRam(addr: number): number {
    return this.ram[(addr - 0xa000) % Math.max(1, this.ram.length)] ?? 0xff;
  }

  writeRam(addr: number, value: number): void {
    if (this.ram.length > 0) this.ram[(addr - 0xa000) % this.ram.length] = value;
  }

  writeState(w: StateWriter): void {
    w.bytes(this.ram);
  }

  readState(r: StateReader): void {
    r.bytes(this.ram);
  }
}
