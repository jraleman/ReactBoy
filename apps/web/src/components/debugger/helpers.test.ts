import { describe, expect, it } from 'vitest';
import { IO, PALETTES, toAbgr } from '@reactboy/core';
import { disassembleAround } from './disassembly';
import { parseAddress, regionOf } from './hex';
import { IO_GROUPS } from './io-registers';
import { colorsFor, drawTile, tileAddress } from './vram';

const describeRegister = (addr: number, value: number) =>
  IO_GROUPS.flatMap((g) => g.registers).find((r) => r.addr === addr)!.describe!(value);

describe('debugger helpers', () => {
  it('parses hex addresses in the usual notations', () => {
    expect(parseAddress('c000')).toBe(0xc000);
    expect(parseAddress(' $FF40 ')).toBe(0xff40);
    expect(parseAddress('0x150')).toBe(0x150);
    expect(parseAddress('10000')).toBeNull();
    expect(parseAddress('zz')).toBeNull();
    expect(parseAddress('')).toBeNull();
    expect(regionOf(0xff80).name).toBe('HRAM');
    expect(regionOf(0x7fff).name).toBe('ROMX');
  });

  it('disassembles in step with the instructions leading up to an address', () => {
    const memory = new Uint8Array(0x10000);
    memory.set([0x01, 0x34, 0x12, 0x00, 0xc3, 0x00, 0x01, 0x3c], 0x100);
    const lines = disassembleAround(memory, 0x107, 3, 2);
    expect(lines.map((l) => l.addr)).toEqual([0x100, 0x103, 0x104, 0x107, 0x108]);
    expect(lines.map((l) => l.text)).toEqual(['LD BC,$1234', 'NOP', 'JP $0100', 'INC A', 'NOP']);
    // Nothing comes before address 0.
    expect(disassembleAround(memory, 0, 3, 1).map((l) => l.addr)).toEqual([0]);
  });

  it('finds tiles under both addressing modes', () => {
    expect(tileAddress(0x10, 0x80)).toBe(0x8800);
    expect(tileAddress(0x00, 0x00)).toBe(0x9000);
    expect(tileAddress(0x00, 0x80)).toBe(0x8800);
    expect(tileAddress(0x00, 0xff)).toBe(0x8ff0);
  });

  it('draws tiles through a palette register, with flips and transparency', () => {
    const memory = new Uint8Array(0x10000);
    memory[0x8000] = 0b1000_0000; // row 0: leftmost pixel color 1
    memory[0x8001] = 0b0000_0001; // row 0: rightmost pixel color 2
    const palette = PALETTES.mono;
    const colors = colorsFor(palette, 0b11_10_01_00);
    const pixels = new Uint32Array(64);
    drawTile(pixels, 8, memory, 0x8000, 0, 0, colors);
    expect(pixels[0]).toBe(toAbgr(palette[1]));
    expect(pixels[7]).toBe(toAbgr(palette[2]));
    expect(pixels[1]).toBe(toAbgr(palette[0]));

    const flipped = new Uint32Array(64);
    drawTile(flipped, 8, memory, 0x8000, 0, 0, colorsFor(palette, 0xe4, true), { flipX: true });
    expect(flipped[7]).toBe(toAbgr(palette[1]));
    expect(flipped[0]).toBe(toAbgr(palette[2]));
    expect(flipped[1]).toBe(0);
  });

  it('spells out register bits', () => {
    expect(describeRegister(IO.LCDC, 0x91)).toBe(
      'LCD on, BG on, BG map $9800, tiles $8000, window map $9800, sprites off, 8×8 sprites',
    );
    expect(describeRegister(IO.STAT, 0x85)).toBe('VBlank, LY=LYC; interrupts: none');
    expect(describeRegister(IO.TAC, 0x05)).toBe('On, 262,144 Hz');
    expect(describeRegister(IO.IE, 0x05)).toBe('Enabled: VBlank, Timer');
    expect(describeRegister(IO.P1, 0xef)).toBe('Reading d-pad; held: none');
    expect(describeRegister(IO.P1, 0xde)).toBe('Reading buttons; held: A');
    expect(describeRegister(0xff26, 0x83)).toBe('Sound on; playing: ch 1, ch 2');
  });
});
