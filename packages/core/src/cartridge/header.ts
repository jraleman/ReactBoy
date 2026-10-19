export type MapperKind = 'ROM' | 'MBC1' | 'MBC2' | 'MBC3' | 'MBC5' | 'unsupported';

export interface CartridgeHeader {
  title: string;
  /** Raw cartridge type byte at 0x147. */
  type: number;
  mapper: MapperKind;
  /** Human-readable cartridge type, e.g. "MBC1+RAM+BATTERY". */
  typeName: string;
  hasRam: boolean;
  hasBattery: boolean;
  hasRtc: boolean;
  romSize: number;
  ramSize: number;
  /** 0x80: works on CGB with enhancements, 0xC0: CGB only. */
  cgbFlag: number;
  headerChecksum: number;
  headerChecksumValid: boolean;
}

interface TypeInfo {
  name: string;
  mapper: MapperKind;
  ram?: boolean;
  battery?: boolean;
  rtc?: boolean;
}

const TYPES: Record<number, TypeInfo> = {
  0x00: { name: 'ROM ONLY', mapper: 'ROM' },
  0x01: { name: 'MBC1', mapper: 'MBC1' },
  0x02: { name: 'MBC1+RAM', mapper: 'MBC1', ram: true },
  0x03: { name: 'MBC1+RAM+BATTERY', mapper: 'MBC1', ram: true, battery: true },
  0x05: { name: 'MBC2', mapper: 'MBC2', ram: true },
  0x06: { name: 'MBC2+BATTERY', mapper: 'MBC2', ram: true, battery: true },
  0x08: { name: 'ROM+RAM', mapper: 'ROM', ram: true },
  0x09: { name: 'ROM+RAM+BATTERY', mapper: 'ROM', ram: true, battery: true },
  0x0f: { name: 'MBC3+TIMER+BATTERY', mapper: 'MBC3', battery: true, rtc: true },
  0x10: { name: 'MBC3+TIMER+RAM+BATTERY', mapper: 'MBC3', ram: true, battery: true, rtc: true },
  0x11: { name: 'MBC3', mapper: 'MBC3' },
  0x12: { name: 'MBC3+RAM', mapper: 'MBC3', ram: true },
  0x13: { name: 'MBC3+RAM+BATTERY', mapper: 'MBC3', ram: true, battery: true },
  0x19: { name: 'MBC5', mapper: 'MBC5' },
  0x1a: { name: 'MBC5+RAM', mapper: 'MBC5', ram: true },
  0x1b: { name: 'MBC5+RAM+BATTERY', mapper: 'MBC5', ram: true, battery: true },
  0x1c: { name: 'MBC5+RUMBLE', mapper: 'MBC5' },
  0x1d: { name: 'MBC5+RUMBLE+RAM', mapper: 'MBC5', ram: true },
  0x1e: { name: 'MBC5+RUMBLE+RAM+BATTERY', mapper: 'MBC5', ram: true, battery: true },
};

const RAM_SIZES: Record<number, number> = {
  0x00: 0,
  0x01: 0x800,
  0x02: 0x2000,
  0x03: 0x8000,
  0x04: 0x20000,
  0x05: 0x10000,
};

export class InvalidRomError extends Error {
  override name = 'InvalidRomError';
}

const byteAt = (rom: Uint8Array, addr: number): number => rom[addr] ?? 0;

export function parseHeader(rom: Uint8Array): CartridgeHeader {
  if (rom.length < 0x150) {
    throw new InvalidRomError(`File is too small to be a Game Boy ROM (${rom.length} bytes).`);
  }

  const cgbFlag = byteAt(rom, 0x143);
  // CGB-aware titles are 11-15 chars; stop at the first non-printable byte either way.
  let title = '';
  for (let addr = 0x134; addr < (cgbFlag & 0x80 ? 0x143 : 0x144); addr++) {
    const ch = byteAt(rom, addr);
    if (ch < 0x20 || ch > 0x7e) break;
    title += String.fromCharCode(ch);
  }

  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++)
    checksum = (checksum - byteAt(rom, addr) - 1) & 0xff;
  const headerChecksum = byteAt(rom, 0x14d);

  const type = byteAt(rom, 0x147);
  const info = TYPES[type];
  const romSizeCode = byteAt(rom, 0x148);
  const ramSizeCode = byteAt(rom, 0x149);

  let ramSize = info?.ram ? (RAM_SIZES[ramSizeCode] ?? 0) : 0;
  // MBC2 has 512 half-bytes of built-in RAM and reports 0 in the header.
  if (info?.mapper === 'MBC2') ramSize = 0x200;

  return {
    title: title.trim() || 'UNTITLED',
    type,
    mapper: info?.mapper ?? 'unsupported',
    typeName: info?.name ?? `UNKNOWN (0x${type.toString(16).padStart(2, '0')})`,
    hasRam: ramSize > 0,
    hasBattery: info?.battery ?? false,
    hasRtc: info?.rtc ?? false,
    romSize: romSizeCode <= 8 ? 0x8000 << romSizeCode : rom.length,
    ramSize,
    cgbFlag,
    headerChecksum,
    headerChecksumValid: checksum === headerChecksum,
  };
}
