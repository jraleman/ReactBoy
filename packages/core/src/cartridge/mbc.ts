/** A cartridge as seen from the bus: ROM at 0x0000-0x7FFF and external RAM at 0xA000-0xBFFF. */
export interface Mbc {
  readRom(addr: number): number;
  /** Writes to ROM space configure the mapper. */
  writeRom(addr: number, value: number): void;
  readRam(addr: number): number;
  writeRam(addr: number, value: number): void;
  /** Battery-backed RAM contents (empty when the cartridge has none). */
  readonly ram: Uint8Array;
}

/** Offset of a 16 KiB ROM bank, wrapped to the banks actually present. */
export function romBankOffset(rom: Uint8Array, bank: number): number {
  const banks = Math.max(2, rom.length >> 14);
  return (bank % banks) << 14;
}

/** Offset of an 8 KiB RAM bank, wrapped to the RAM actually present. */
export function ramBankOffset(ram: Uint8Array, bank: number): number {
  const banks = Math.max(1, ram.length >> 13);
  return (bank % banks) << 13;
}
