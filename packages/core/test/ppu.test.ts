import { describe, expect, it } from 'vitest';
import { Interrupts } from '../src/interrupts';
import { Ppu, PpuMode } from '../src/ppu/ppu';

const dots = (ppu: Ppu, n: number) => {
  for (let i = 0; i < n / 4; i++) ppu.tick();
};

describe('PPU timing', () => {
  it('walks modes 2 -> 3 -> 0 across a line and enters VBlank at line 144', () => {
    const interrupts = new Interrupts();
    interrupts.flags = 0;
    const ppu = new Ppu(interrupts);
    expect(ppu.mode).toBe(PpuMode.OamScan);
    dots(ppu, 80);
    expect(ppu.mode).toBe(PpuMode.OamScan);
    dots(ppu, 4);
    expect(ppu.mode).toBe(PpuMode.Drawing);
    dots(ppu, 168);
    expect(ppu.mode).toBe(PpuMode.Drawing);
    dots(ppu, 4);
    expect(ppu.mode).toBe(PpuMode.HBlank);
    dots(ppu, 200);
    // LY changes an M-cycle before STAT shows mode 2.
    expect([ppu.ly, ppu.mode, ppu.oamReadable()]).toEqual([1, PpuMode.HBlank, false]);
    dots(ppu, 4);
    expect([ppu.ly, ppu.mode]).toEqual([1, PpuMode.OamScan]);
    dots(ppu, 456 * 143 - 4);
    expect([ppu.ly, ppu.mode]).toEqual([144, PpuMode.VBlank]);
    expect(interrupts.flags & 0x01).toBe(1);
    expect(ppu.frameCount).toBe(1);
    dots(ppu, 456 * 10);
    expect([ppu.ly, ppu.mode]).toEqual([0, PpuMode.OamScan]);
  });

  it('raises STAT on LY=LYC only on the rising edge', () => {
    const interrupts = new Interrupts();
    interrupts.flags = 0;
    const ppu = new Ppu(interrupts);
    ppu.writeStat(0x40);
    ppu.writeLyc(2);
    dots(ppu, 456 * 2);
    // The comparison catches up with LY one M-cycle into the line.
    expect(interrupts.flags & 0x02).toBe(0);
    dots(ppu, 4);
    expect(interrupts.flags & 0x02).toBe(2);
    interrupts.flags = 0;
    dots(ppu, 200);
    expect(interrupts.flags & 0x02).toBe(0);
    expect(ppu.readStat() & 0x04).toBe(0x04);
  });

  it('lengthens mode 3 for fine scrolling and sprites', () => {
    const hblankAt = (setup: (ppu: Ppu) => void) => {
      const ppu = new Ppu(new Interrupts());
      ppu.lcdc |= 0x02; // sprites on
      setup(ppu);
      let dot = 0;
      for (; ppu.mode !== PpuMode.HBlank; dot += 4) ppu.tick();
      return dot;
    };
    const sprites = (ppu: Ppu, xs: number[]) => xs.forEach((x, i) => ppu.oam.set([16, x], i * 4)); // on line 0
    expect(hblankAt(() => {})).toBe(256);
    expect(hblankAt((ppu) => (ppu.scx = 5))).toBe(260);
    expect(hblankAt((ppu) => sprites(ppu, [0]))).toBe(264); // 11 dots
    expect(hblankAt((ppu) => sprites(ppu, [4]))).toBe(260); // 7 dots
    expect(hblankAt((ppu) => sprites(ppu, Array(10).fill(0)))).toBe(320); // 11 + 9 x 6
    expect(hblankAt((ppu) => sprites(ppu, [168]))).toBe(256); // off the right edge
  });

  it('reads LY=0 for most of line 153, where LYC=0 matches', () => {
    const ppu = new Ppu(new Interrupts());
    dots(ppu, 456 * 153);
    expect(ppu.ly).toBe(153);
    dots(ppu, 4);
    expect([ppu.ly, ppu.readStat() & 0x04]).toEqual([0, 0]);
    dots(ppu, 8);
    expect(ppu.readStat() & 0x04).toBe(0x04);
  });

  it('blocks VRAM in mode 3 and OAM in modes 2-3', () => {
    const ppu = new Ppu(new Interrupts());
    expect([ppu.vramReadable(), ppu.oamReadable()]).toEqual([true, false]);
    dots(ppu, 84);
    expect([ppu.vramReadable(), ppu.oamReadable()]).toEqual([false, false]);
    dots(ppu, 172);
    expect([ppu.vramReadable(), ppu.oamReadable()]).toEqual([true, true]);
  });
});
