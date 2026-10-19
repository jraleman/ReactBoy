import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../constants';
import { Interrupt, type Interrupts } from '../interrupts';
import { PALETTES, toAbgr, type Palette } from './palette';

export const PpuMode = {
  HBlank: 0,
  VBlank: 1,
  OamScan: 2,
  Drawing: 3,
} as const;

export type PpuModeId = (typeof PpuMode)[keyof typeof PpuMode];

const DOTS_PER_LINE = 456;
const OAM_SCAN_DOTS = 80;
/** Mode 3 length without sprite/scroll penalties; a scanline renderer doesn't model those. */
const DRAWING_DOTS = 172;
const LINES_PER_FRAME = 154;
const MAX_SPRITES_PER_LINE = 10;

/**
 * Pixel processing unit, rendering one scanline at a time when mode 3 begins. Mode timing,
 * LY/LYC and STAT interrupts are dot-accurate to the M-cycle; mid-scanline register writes
 * are not reflected (a pixel FIFO is a later stretch goal).
 */
export class Ppu {
  /** 8 KiB VRAM. A CGB would add a second bank. */
  readonly vram = new Uint8Array(0x2000);
  readonly oam = new Uint8Array(0xa0);
  /** Last completed frame, RGBA. */
  readonly framebuffer = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  /** Completed frames since power-on; bumps at the start of VBlank. */
  frameCount = 0;

  lcdc = 0x91;
  scy = 0;
  scx = 0;
  ly = 0;
  lyc = 0;
  bgp = 0xfc;
  obp0 = 0xff;
  obp1 = 0xff;
  wy = 0;
  wx = 0;
  /** STAT bits 3-6: interrupt sources. */
  private statSources = 0;
  mode: PpuModeId = PpuMode.OamScan;

  private dot = 0;
  private statLine = false;
  /** Set once LY == WY during a frame; the window can only appear after that. */
  private windowTriggered = false;
  /** Internal window line counter: advances only on lines where the window was drawn. */
  private windowLine = 0;

  private readonly back = new Uint8ClampedArray(this.framebuffer.length);
  private readonly backPixels = new Uint32Array(this.back.buffer);
  private readonly colors = new Uint32Array(4);
  private readonly bgIndex = new Uint8Array(SCREEN_WIDTH);
  private readonly objColor = new Uint8Array(SCREEN_WIDTH);
  private readonly objAttr = new Uint8Array(SCREEN_WIDTH);
  private readonly lineSprites: number[] = [];

  constructor(private readonly interrupts: Interrupts) {
    this.setPalette(PALETTES.classic);
  }

  setPalette(palette: Palette): void {
    palette.forEach((rgb, i) => (this.colors[i] = toAbgr(rgb)));
  }

  get lcdOn(): boolean {
    return (this.lcdc & 0x80) !== 0;
  }

  vramAccessible(): boolean {
    return !this.lcdOn || this.mode !== PpuMode.Drawing;
  }

  oamAccessible(): boolean {
    return !this.lcdOn || this.mode < PpuMode.OamScan;
  }

  /** Advances one M-cycle (4 dots). */
  tick(): void {
    if (!this.lcdOn) return;
    this.dot += 4;
    if (this.ly < SCREEN_HEIGHT) {
      if (this.dot === OAM_SCAN_DOTS) {
        this.setMode(PpuMode.Drawing);
        this.renderLine();
      } else if (this.dot === OAM_SCAN_DOTS + DRAWING_DOTS) {
        this.setMode(PpuMode.HBlank);
      }
    }
    if (this.dot < DOTS_PER_LINE) return;

    this.dot = 0;
    this.ly = (this.ly + 1) % LINES_PER_FRAME;
    if (this.ly === SCREEN_HEIGHT) {
      this.setMode(PpuMode.VBlank);
      this.interrupts.request(Interrupt.VBlank);
      this.presentFrame();
    } else if (this.ly < SCREEN_HEIGHT) {
      if (this.ly === 0) {
        this.windowTriggered = false;
        this.windowLine = 0;
      }
      this.setMode(PpuMode.OamScan);
    } else {
      this.updateStatLine();
    }
  }

  readStat(): number {
    const coincidence = this.ly === this.lyc ? 0x04 : 0;
    return 0x80 | this.statSources | coincidence | (this.lcdOn ? this.mode : 0);
  }

  writeStat(value: number): void {
    this.statSources = value & 0x78;
    this.updateStatLine();
  }

  writeLcdc(value: number): void {
    const wasOn = this.lcdOn;
    this.lcdc = value;
    if (wasOn && !this.lcdOn) {
      // Turning the LCD off resets the PPU and blanks the screen.
      this.ly = 0;
      this.dot = 0;
      this.mode = PpuMode.HBlank;
      this.statLine = false;
      this.backPixels.fill(this.colors[0]!);
      this.presentFrame();
    } else if (!wasOn && this.lcdOn) {
      // The first line after power-on skips OAM scan: it starts in mode 0.
      this.dot = 0;
      this.mode = PpuMode.HBlank;
      this.windowTriggered = false;
      this.windowLine = 0;
      this.updateStatLine();
    }
  }

  writeLyc(value: number): void {
    this.lyc = value;
    this.updateStatLine();
  }

  private setMode(mode: PpuModeId): void {
    this.mode = mode;
    this.updateStatLine();
  }

  /** STAT interrupts fire on the rising edge of the OR of all enabled sources. */
  private updateStatLine(): void {
    if (!this.lcdOn) return;
    const s = this.statSources;
    const line =
      ((s & 0x40) !== 0 && this.ly === this.lyc) ||
      ((s & 0x08) !== 0 && this.mode === PpuMode.HBlank) ||
      ((s & 0x10) !== 0 && this.mode === PpuMode.VBlank) ||
      ((s & 0x20) !== 0 && this.mode === PpuMode.OamScan);
    if (line && !this.statLine) this.interrupts.request(Interrupt.Stat);
    this.statLine = line;
  }

  private presentFrame(): void {
    this.framebuffer.set(this.back);
    this.frameCount++;
  }

  private renderLine(): void {
    const { lcdc, ly, bgIndex } = this;
    if (!this.windowTriggered && ly === this.wy) this.windowTriggered = true;

    // DMG: LCDC bit 0 off blanks both background and window to color 0.
    if (lcdc & 0x01) {
      const windowVisible = (lcdc & 0x20) !== 0 && this.windowTriggered && this.wx <= 166;
      const windowStart = windowVisible ? this.wx - 7 : SCREEN_WIDTH;
      const bgEnd = Math.max(0, Math.min(SCREEN_WIDTH, windowStart));

      const y = (ly + this.scy) & 0xff;
      this.fetchTiles((lcdc & 0x08) !== 0, y, 0, bgEnd, this.scx);

      if (windowStart < SCREEN_WIDTH) {
        const start = Math.max(0, windowStart);
        this.fetchTiles((lcdc & 0x40) !== 0, this.windowLine, start, SCREEN_WIDTH, -windowStart);
        this.windowLine++;
      }
    } else {
      bgIndex.fill(0);
    }

    this.objColor.fill(0);
    if (lcdc & 0x02) this.renderSprites();

    const pixels = this.backPixels;
    const colors = this.colors;
    const row = ly * SCREEN_WIDTH;
    const bgp = this.bgp;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const bg = bgIndex[x]!;
      const obj = this.objColor[x]!;
      let shade = (bgp >> (bg * 2)) & 3;
      if (obj !== 0) {
        const attr = this.objAttr[x]!;
        // Attribute bit 7: background colors 1-3 are drawn over the sprite.
        if ((attr & 0x80) === 0 || bg === 0) {
          const obp = attr & 0x10 ? this.obp1 : this.obp0;
          shade = (obp >> (obj * 2)) & 3;
        }
      }
      pixels[row + x] = colors[shade]!;
    }
  }

  /**
   * Fills bgIndex[from, to) from a 32x32 tile map.
   * @param y row within the map, in pixels
   * @param xOffset map x of screen x=0
   */
  private fetchTiles(highMap: boolean, y: number, from: number, to: number, xOffset: number): void {
    const vram = this.vram;
    const unsignedTiles = (this.lcdc & 0x10) !== 0;
    const rowBase = (highMap ? 0x1c00 : 0x1800) + (y >> 3) * 32;
    const tileRow = (y & 7) * 2;
    for (let x = from; x < to; x++) {
      const mapX = (x + xOffset) & 0xff;
      const tile = vram[rowBase + (mapX >> 3)]!;
      const addr = (unsignedTiles ? tile * 16 : 0x1000 + ((tile << 24) >> 24) * 16) + tileRow;
      const bit = 7 - (mapX & 7);
      this.bgIndex[x] = (((vram[addr + 1]! >> bit) & 1) << 1) | ((vram[addr]! >> bit) & 1);
    }
  }

  private renderSprites(): void {
    const { oam, vram, ly } = this;
    const height = this.lcdc & 0x04 ? 16 : 8;
    const sprites = this.lineSprites;
    sprites.length = 0;
    for (let i = 0; i < 40 && sprites.length < MAX_SPRITES_PER_LINE; i++) {
      const top = oam[i * 4]! - 16;
      if (ly >= top && ly < top + height) sprites.push(i);
    }
    // DMG priority: smaller X wins, then lower OAM index. Draw lowest priority first so
    // the winner's opaque pixels end up on top.
    sprites.sort((a, b) => oam[a * 4 + 1]! - oam[b * 4 + 1]! || a - b);
    for (let s = sprites.length - 1; s >= 0; s--) {
      const base = sprites[s]! * 4;
      const left = oam[base + 1]! - 8;
      const attr = oam[base + 3]!;
      let row = ly - (oam[base]! - 16);
      if (attr & 0x40) row = height - 1 - row;
      const tile = height === 16 ? oam[base + 2]! & 0xfe : oam[base + 2]!;
      const addr = tile * 16 + row * 2;
      const lo = vram[addr]!;
      const hi = vram[addr + 1]!;
      for (let px = 0; px < 8; px++) {
        const x = left + px;
        if (x < 0 || x >= SCREEN_WIDTH) continue;
        const bit = attr & 0x20 ? px : 7 - px;
        const color = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        if (color === 0) continue;
        this.objColor[x] = color;
        this.objAttr[x] = attr;
      }
    }
  }
}
