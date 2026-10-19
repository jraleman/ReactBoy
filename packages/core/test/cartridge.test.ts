import { describe, expect, it } from 'vitest';
import { createCartridge, InvalidRomError, parseHeader, UnsupportedCartridgeError } from '../src';
import { makeRom } from './helpers/rom-builder';

const now = () => 0;

describe('parseHeader', () => {
  it('reads title, type, sizes and validates the checksum', () => {
    const header = parseHeader(
      makeRom([], { type: 0x03, romSizeCode: 2, ramSizeCode: 3, title: 'ZELDA' }),
    );
    expect(header).toMatchObject({
      title: 'ZELDA',
      mapper: 'MBC1',
      typeName: 'MBC1+RAM+BATTERY',
      hasBattery: true,
      romSize: 0x20000,
      ramSize: 0x8000,
      headerChecksumValid: true,
    });
  });

  it('flags a bad header checksum', () => {
    const rom = makeRom([]);
    rom[0x14d]! ^= 0xff;
    expect(parseHeader(rom).headerChecksumValid).toBe(false);
  });

  it('rejects files that are too small', () => {
    expect(() => parseHeader(new Uint8Array(0x100))).toThrow(InvalidRomError);
  });
});

describe('createCartridge', () => {
  it('rejects CGB-only and unknown cartridges', () => {
    const cgb = makeRom([]);
    cgb[0x143] = 0xc0;
    expect(() => createCartridge(cgb, now)).toThrow(UnsupportedCartridgeError);
    expect(() => createCartridge(makeRom([], { type: 0xfc }), now)).toThrow(
      UnsupportedCartridgeError,
    );
  });

  /** Marks every 16 KiB bank with its own number at offset 0. */
  const bankedRom = (type: number, romSizeCode: number, ramSizeCode = 0) => {
    const rom = makeRom([], { type, romSizeCode, ramSizeCode });
    for (let bank = 1; bank < rom.length >> 14; bank++) {
      rom[bank << 14] = bank & 0xff;
      rom[(bank << 14) + 1] = bank >> 8;
    }
    return rom;
  };
  const bankAt4000 = (read: (addr: number) => number) => read(0x4000) | (read(0x4001) << 8);

  it('MBC1 maps bank 0 writes to bank 1 and combines the upper bank bits', () => {
    const { mbc } = createCartridge(bankedRom(0x01, 6), now); // 2 MiB, 128 banks
    const read = (a: number) => mbc.readRom(a);
    expect(bankAt4000(read)).toBe(1);
    mbc.writeRom(0x2000, 0x00);
    expect(bankAt4000(read)).toBe(1);
    mbc.writeRom(0x2000, 0x05);
    mbc.writeRom(0x4000, 0x02);
    expect(bankAt4000(read)).toBe(0x45);
  });

  it('MBC1 gates RAM behind the enable register', () => {
    const { mbc } = createCartridge(bankedRom(0x03, 1, 2), now);
    mbc.writeRam(0xa000, 0x42);
    expect(mbc.readRam(0xa000)).toBe(0xff);
    mbc.writeRom(0x0000, 0x0a);
    mbc.writeRam(0xa000, 0x42);
    expect(mbc.readRam(0xa000)).toBe(0x42);
  });

  it('MBC5 supports 9-bit bank numbers and bank 0 in the switchable slot', () => {
    const { mbc } = createCartridge(bankedRom(0x19, 8), now); // 8 MiB, 512 banks
    const read = (a: number) => mbc.readRom(a);
    mbc.writeRom(0x2000, 0x2a);
    mbc.writeRom(0x3000, 0x01);
    expect(bankAt4000(read)).toBe(0x12a);
    mbc.writeRom(0x2000, 0x00);
    mbc.writeRom(0x3000, 0x00);
    expect(bankAt4000(read)).toBe(0);
  });

  it('MBC3 RTC advances with emulated time and is read through the latch', () => {
    let cycles = 0;
    const { mbc } = createCartridge(bankedRom(0x10, 1, 2), () => cycles);
    mbc.writeRom(0x0000, 0x0a);
    cycles = 4_194_304 * 125; // 2 min 5 s
    mbc.writeRom(0x6000, 0);
    mbc.writeRom(0x6000, 1);
    mbc.writeRom(0x4000, 0x08);
    expect(mbc.readRam(0xa000)).toBe(5);
    mbc.writeRom(0x4000, 0x09);
    expect(mbc.readRam(0xa000)).toBe(2);
  });
});
