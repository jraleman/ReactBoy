import { describe, expect, it } from 'vitest';
import { GameBoy, IO } from '../src';
import { Interrupts } from '../src/interrupts';
import { Ppu, PpuMode } from '../src/ppu/ppu';
import { makeRom } from './helpers/rom-builder';

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

describe('Game Boy Color graphics', () => {
  const colorGb = () => new GameBoy(makeRom([0x18, 0xfe]), { model: 'cgb' }); // JR -2
  /** Sets a color in background palette 0 through BCPS/BCPD. */
  const setBgColor = (gb: GameBoy, index: number, color: number) => {
    gb.write(IO.BCPS, 0x80 | (index * 2));
    gb.write(IO.BCPD, color & 0xff);
    gb.write(IO.BCPD, color >> 8);
  };
  const rgbAt = (gb: GameBoy, x: number, y: number) => {
    const i = (y * 160 + x) * 4;
    const fb = gb.framebuffer;
    return (fb[i]! << 16) | (fb[i + 1]! << 8) | fb[i + 2]!;
  };
  const RED = 0x001f;
  const BLUE = 0x7c00;

  it('steps through palette RAM after writes when BCPS or OCPS bit 7 is set', () => {
    const gb = colorGb();
    gb.write(IO.BCPS, 0xbe);
    expect(gb.read(IO.BCPS)).toBe(0xfe);
    for (const value of [0x12, 0x34, 0x56]) gb.write(IO.BCPD, value);
    // The index wraps within the 64 bytes and keeps stepping.
    expect(gb.read(IO.BCPS)).toBe(0xc1);
    const bg = gb.ppu.bgPalettes;
    expect([bg[0x3e], bg[0x3f], bg[0x00]]).toEqual([0x12, 0x34, 0x56]);

    gb.write(IO.OCPS, 0x05);
    gb.write(IO.OCPD, 0xaa);
    gb.write(IO.OCPD, 0xbb);
    expect(gb.read(IO.OCPS)).toBe(0x45);
    expect([gb.read(IO.OCPD), gb.read(IO.OCPD)]).toEqual([0xbb, 0xbb]);
    expect(gb.ppu.objPalettes[5]).toBe(0xbb);
  });

  it('locks palette RAM during mode 3, but a blocked write still steps the index', () => {
    const gb = colorGb();
    while (gb.ppu.mode !== PpuMode.Drawing) gb.tick();
    gb.write(IO.BCPS, 0x80);
    gb.write(IO.BCPD, 0x00);
    expect(gb.read(IO.BCPS)).toBe(0xc1);
    expect(gb.read(IO.BCPD)).toBe(0xff);
    expect(gb.ppu.bgPalettes[0]).toBe(0xff);
  });

  it('draws palettes rewritten mid-frame', () => {
    const gb = colorGb();
    gb.setColorCorrection('raw');
    gb.runFrame();
    setBgColor(gb, 0, RED);
    while (gb.ppu.ly !== 72 || gb.ppu.mode !== PpuMode.HBlank) gb.step();
    setBgColor(gb, 0, BLUE);
    gb.runFrame();
    expect([rgbAt(gb, 0, 0), rgbAt(gb, 159, 71)]).toEqual([0xff0000, 0xff0000]);
    expect([rgbAt(gb, 0, 72), rgbAt(gb, 159, 143)]).toEqual([0x0000ff, 0x0000ff]);
  });

  it('shows colors as the handheld LCD did unless asked for raw ones', () => {
    const gb = colorGb();
    setBgColor(gb, 0, RED);
    gb.runFrame();
    gb.runFrame();
    expect(rgbAt(gb, 0, 0)).toBe(0xcf0030);
    gb.setColorCorrection('raw');
    expect(rgbAt(gb, 0, 0)).toBe(0xff0000);
    setBgColor(gb, 0, 0x7fff);
    gb.runFrame();
    expect(rgbAt(gb, 0, 0)).toBe(0xffffff);
    gb.setColorCorrection('lcd');
    expect(rgbAt(gb, 0, 0)).toBe(0xffffff);
  });

  it('goes white when the LCD is switched off', () => {
    const gb = colorGb();
    setBgColor(gb, 0, 0);
    gb.runFrame();
    gb.runFrame();
    expect(rgbAt(gb, 80, 72)).toBe(0x000000);
    gb.write(IO.LCDC, 0x00);
    expect(rgbAt(gb, 80, 72)).toBe(0xffffff);
  });
});
