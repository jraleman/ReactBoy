import { InvalidRomError, parseHeader, type CartridgeHeader } from './header';
import type { Mbc } from './mbc';
import { Mbc0 } from './mbc0';
import { Mbc1 } from './mbc1';
import { Mbc2 } from './mbc2';
import { Mbc3 } from './mbc3';
import { Mbc5 } from './mbc5';

export { InvalidRomError, parseHeader };
export type { CartridgeHeader, MapperKind } from './header';
export type { Mbc } from './mbc';

export class UnsupportedCartridgeError extends Error {
  override name = 'UnsupportedCartridgeError';
}

export interface Cartridge {
  header: CartridgeHeader;
  mbc: Mbc;
}

/**
 * Parses a ROM and builds the matching mapper.
 * @param now total emulated T-cycles, used by MBC3's real-time clock.
 */
export function createCartridge(rom: Uint8Array, now: () => number): Cartridge {
  const header = parseHeader(rom);
  if (header.cgbFlag === 0xc0) {
    throw new UnsupportedCartridgeError(`"${header.title}" requires a Game Boy Color.`);
  }
  const ram = new Uint8Array(header.ramSize).fill(0xff);
  let mbc: Mbc;
  switch (header.mapper) {
    case 'ROM':
      mbc = new Mbc0(rom, ram);
      break;
    case 'MBC1':
      mbc = new Mbc1(rom, ram);
      break;
    case 'MBC2':
      mbc = new Mbc2(rom, ram);
      break;
    case 'MBC3':
      mbc = new Mbc3(rom, ram, header.hasRtc, now);
      break;
    case 'MBC5':
      mbc = new Mbc5(rom, ram, header.type >= 0x1c);
      break;
    default:
      throw new UnsupportedCartridgeError(
        `Cartridge type ${header.typeName} is not supported yet.`,
      );
  }
  return { header, mbc };
}
