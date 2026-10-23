import { describe, expect, it } from 'vitest';
import { GameBoy, IO, PpuMode } from '../src';
import { makeRom } from './helpers/rom-builder';

const T0 = 1_700_000_000_000;
const spin = makeRom([0x18, 0xfe]); // JR -2

/** A Game Boy Color with 0xC000-0xC0FF holding 1, 2, 3, ... */
function colorGb(): GameBoy {
  const gb = new GameBoy(spin, { model: 'cgb' });
  for (let i = 0; i < 0x100; i++) gb.write(0xc000 + i, i + 1);
  return gb;
}

function setAddresses(gb: GameBoy, source: number, dest: number): void {
  gb.write(IO.HDMA1, source >> 8);
  gb.write(IO.HDMA2, source & 0xff);
  gb.write(IO.HDMA3, dest >> 8);
  gb.write(IO.HDMA4, dest & 0xff);
}

/** Bytes 0x8000 + offset onwards in VRAM bank 0. */
const vram = (gb: GameBoy, offset: number, length: number) =>
  Array.from(gb.ppu.vram.subarray(offset, offset + length));
/** What {@link colorGb} put from 0xC000 + from - 1 on. */
const counting = (from: number, length: number) =>
  Array.from({ length }, (_, i) => (from + i) & 0xff);

describe('Game Boy Color VRAM DMA', () => {
  it('copies all at once with general-purpose DMA, stalling the CPU 8 M-cycles a block', () => {
    const gb = colorGb();
    gb.write(IO.LCDC, 0x00);
    // The low 4 bits of both addresses and the top 3 of the destination are ignored.
    setAddresses(gb, 0xc00f, 0xe80f);
    gb.write(IO.VBK, 1);
    gb.write(IO.HDMA5, 0x01);
    const before = gb.cycles;
    gb.tick();
    expect(gb.cycles - before).toBe(4 + 2 * 8 * 4);
    expect(Array.from(gb.ppu.vram.subarray(0x2800, 0x2820))).toEqual(counting(1, 32));
    expect(vram(gb, 0x800, 32)).toEqual(new Array(32).fill(0));
    expect(gb.read(IO.HDMA5)).toBe(0xff);
    expect([IO.HDMA1, IO.HDMA2, IO.HDMA3, IO.HDMA4].map((r) => gb.read(r))).toEqual([
      0xff, 0xff, 0xff, 0xff,
    ]);
  });

  it('copies a block each HBlank, and can be stopped and carried on', () => {
    const gb = colorGb();
    const untilLine = (ly: number) => {
      while (gb.ppu.ly !== ly || gb.ppu.mode !== PpuMode.Drawing) gb.tick();
    };
    setAddresses(gb, 0xc000, 0x8000);
    gb.write(IO.HDMA5, 0x83);
    expect(gb.read(IO.HDMA5)).toBe(0x03);
    untilLine(0);
    expect(vram(gb, 0, 16)).toEqual(new Array(16).fill(0));
    untilLine(1);
    expect(vram(gb, 0, 17)).toEqual([...counting(1, 16), 0]);
    expect(gb.read(IO.HDMA5)).toBe(0x02);

    // Clearing bit 7 stops it; the blocks left still show.
    gb.write(IO.HDMA5, 0x00);
    expect(gb.read(IO.HDMA5)).toBe(0x82);
    gb.runFrame();
    expect(vram(gb, 16, 1)).toEqual([0]);

    // Starting again carries on from where the addresses got to.
    gb.write(IO.HDMA5, 0x81);
    gb.runFrame();
    expect(vram(gb, 0, 49)).toEqual([...counting(1, 48), 0]);
    expect(gb.read(IO.HDMA5)).toBe(0xff);
  });

  it('copies the first HBlank block at once when started in mode 0, as with the LCD off', () => {
    const gb = colorGb();
    gb.write(IO.LCDC, 0x00);
    setAddresses(gb, 0xc000, 0x8000);
    gb.write(IO.HDMA5, 0x81);
    gb.tick();
    expect(vram(gb, 0, 17)).toEqual([...counting(1, 16), 0]);
    expect(gb.read(IO.HDMA5)).toBe(0x00);
    // With the LCD off there are no more HBlanks.
    for (let i = 0; i < 20_000; i++) gb.tick();
    expect(gb.read(IO.HDMA5)).toBe(0x00);
  });

  it('stops when the destination runs past VRAM, and reads 0xFF from a VRAM source', () => {
    const gb = colorGb();
    gb.write(IO.LCDC, 0x00);
    setAddresses(gb, 0xc000, 0x9ff0);
    gb.write(IO.HDMA5, 0x03);
    const before = gb.cycles;
    gb.tick();
    expect(gb.cycles - before).toBe(4 + 8 * 4);
    expect(vram(gb, 0x1ff0, 16)).toEqual(counting(1, 16));
    expect(vram(gb, 0, 16)).toEqual(new Array(16).fill(0));
    expect(gb.read(IO.HDMA5)).toBe(0xff);

    setAddresses(gb, 0x9000, 0x8000);
    gb.write(IO.HDMA5, 0x00);
    gb.tick();
    expect(vram(gb, 0, 16)).toEqual(new Array(16).fill(0xff));
  });

  it('saves an HBlank DMA under way', () => {
    const a = colorGb();
    setAddresses(a, 0xc000, 0x8000);
    a.write(IO.HDMA5, 0x8f);
    while (a.ppu.ly !== 3) a.tick();
    const b = new GameBoy(spin, { model: 'cgb' });
    b.deserialize(a.serialize(T0), T0);
    a.runFrame();
    b.runFrame();
    expect(b.read(IO.HDMA5)).toBe(0xff);
    expect(b.serialize(T0)).toEqual(a.serialize(T0));
    expect(vram(b, 0, 256)).toEqual(counting(1, 256));
  });

  it('is absent on a DMG', () => {
    const gb = new GameBoy(spin);
    gb.write(0xc000, 0x42);
    gb.write(IO.LCDC, 0x00);
    setAddresses(gb, 0xc000, 0x8000);
    gb.write(IO.HDMA5, 0x00);
    const before = gb.cycles;
    gb.tick();
    expect(gb.cycles - before).toBe(4);
    expect([gb.read(IO.HDMA5), gb.ppu.vram[0]]).toEqual([0xff, 0]);
  });
});
