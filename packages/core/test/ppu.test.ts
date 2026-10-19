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
    expect(ppu.mode).toBe(PpuMode.Drawing);
    dots(ppu, 172);
    expect(ppu.mode).toBe(PpuMode.HBlank);
    dots(ppu, 204);
    expect([ppu.ly, ppu.mode]).toEqual([1, PpuMode.OamScan]);
    dots(ppu, 456 * 143);
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
    expect(interrupts.flags & 0x02).toBe(2);
    interrupts.flags = 0;
    dots(ppu, 200);
    expect(interrupts.flags & 0x02).toBe(0);
    expect(ppu.readStat() & 0x04).toBe(0x04);
  });

  it('blocks VRAM in mode 3 and OAM in modes 2-3', () => {
    const ppu = new Ppu(new Interrupts());
    expect([ppu.vramAccessible(), ppu.oamAccessible()]).toEqual([true, false]);
    dots(ppu, 80);
    expect([ppu.vramAccessible(), ppu.oamAccessible()]).toEqual([false, false]);
    dots(ppu, 172);
    expect([ppu.vramAccessible(), ppu.oamAccessible()]).toEqual([true, true]);
  });
});
