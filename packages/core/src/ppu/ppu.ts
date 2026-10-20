import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../constants';
import { Interrupt, type Interrupts } from '../interrupts';
import type { StateReader, StateWriter, Stateful } from '../state';
import { PALETTES, toAbgr, type Palette } from './palette';

export const PpuMode = {
  HBlank: 0,
  VBlank: 1,
  OamScan: 2,
  Drawing: 3,
} as const;

export type PpuModeId = (typeof PpuMode)[keyof typeof PpuMode];

const DOTS_PER_LINE = 456;
/**
 * Line timing, in dots from where LY changes. STAT keeps reading mode 0, and LY=LYC false,
 * until {@link LINE_SETTLE}, although OAM reads are blocked and the mode 2 interrupt fires
 * from 0. Between OAM scan and mode 3 there is an M-cycle where VRAM reads are blocked but
 * OAM writes go through. Measured by Mooneye's lcdon_timing, lcdon_write_timing and intr_2
 * tests.
 */
const LINE_SETTLE = 4;
const OAM_SCAN_END = 80;
const DRAWING_START = 84;

/** Bits of Ppu.locks: which CPU accesses to OAM and VRAM the PPU is currently blocking. */
const OAM_READ = 1;
const OAM_WRITE = 2;
const VRAM_READ = 4;
const VRAM_WRITE = 8;
const ALL_LOCKS = OAM_READ | OAM_WRITE | VRAM_READ | VRAM_WRITE;
/**
 * Dot where mode 3 ends with no penalties: STAT reads see mode 0 from the first M-cycle at
 * or after it. The HBlank interrupt is raised a dot earlier, rounded the same way, so it can
 * land an M-cycle before the mode changes (Mooneye's intr_2_0 and hblank_ly_scx tests).
 */
const DRAWING_END = 253;
const HBLANK_IRQ_LEAD = 1;
/** Mode 3 stalls while the fetcher restarts for the window. */
const WINDOW_PENALTY = 6;
const LINES_PER_FRAME = 154;
const MAX_SPRITES_PER_LINE = 10;

/**
 * Pixel processing unit, rendering one scanline at a time when mode 3 begins. Mode timing,
 * LY/LYC and STAT interrupts are dot-accurate to the M-cycle, including how scrolling,
 * sprites and the window lengthen mode 3; mid-scanline register writes are not reflected
 * (that needs a pixel FIFO).
 */
export class Ppu implements Stateful {
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
  /** The mode STAT reports. */
  mode: PpuModeId = PpuMode.OamScan;

  /** Line being drawn. LY follows it, except that it reads 0 for most of line 153. */
  private line = 0;
  private dot = 0;
  private locks = OAM_READ | OAM_WRITE;
  /** The mode 2 STAT source, which leads the mode STAT reports. */
  private oamScanSignal = true;
  /**
   * The first line after the LCD is switched on: it starts 4 dots in and has no OAM scan,
   * so it shows mode 0 until mode 3 and only locks OAM and VRAM during mode 3.
   */
  private lcdOnLine = false;
  /**
   * STAT interrupt line and LY=LYC flag. Both only update while the LCD is on, so they
   * keep their values through an LCD-off period.
   */
  private statLine = false;
  private lyCompare = false;
  /** Dots this line's mode 3 runs past {@link DRAWING_END}, set when it starts. */
  private drawingPenalty = 0;
  /** The HBlank STAT source, which turns on slightly before mode 0 itself. */
  private hblankSignal = false;
  /** Set once LY == WY during a frame; the window can only appear after that. */
  private windowTriggered = false;
  /** Internal window line counter: advances only on lines where the window was drawn. */
  private windowLine = 0;

  private readonly framePixels = new Uint32Array(this.framebuffer.buffer);
  /**
   * Shade (0-3) of each pixel in the frame being drawn and in the last completed one. Colors
   * are applied when a frame is presented, so a palette change can recolor it in place.
   */
  private readonly backShades = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  private readonly frontShades = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  private readonly colors = new Uint32Array(4);
  private readonly bgIndex = new Uint8Array(SCREEN_WIDTH);
  private readonly objColor = new Uint8Array(SCREEN_WIDTH);
  private readonly objAttr = new Uint8Array(SCREEN_WIDTH);
  private readonly lineSprites: number[] = [];

  constructor(private readonly interrupts: Interrupts) {
    this.setPalette(PALETTES.classic);
  }

  /** Also recolors the last completed frame. */
  setPalette(palette: Palette): void {
    palette.forEach((rgb, i) => (this.colors[i] = toAbgr(rgb)));
    this.colorFrame();
  }

  get lcdOn(): boolean {
    return (this.lcdc & 0x80) !== 0;
  }

  vramReadable(): boolean {
    return (this.locks & VRAM_READ) === 0;
  }

  vramWritable(): boolean {
    return (this.locks & VRAM_WRITE) === 0;
  }

  oamReadable(): boolean {
    return (this.locks & OAM_READ) === 0;
  }

  oamWritable(): boolean {
    return (this.locks & OAM_WRITE) === 0;
  }

  /** Advances one M-cycle (4 dots). */
  tick(): void {
    if (!this.lcdOn) return;
    this.dot += 4;
    if (this.dot === DOTS_PER_LINE) {
      this.dot = 0;
      this.startLine((this.line + 1) % LINES_PER_FRAME);
    } else if (this.line < SCREEN_HEIGHT) {
      this.visibleLineTick();
    } else if (this.line === LINES_PER_FRAME - 1) {
      this.lastLineTick();
    } else if (this.dot === LINE_SETTLE) {
      this.compareLy();
    }
  }

  private startLine(line: number): void {
    this.line = line;
    this.lcdOnLine = false;
    if (line === 0) {
      // LY has read 0 since early in line 153, so there's no settling here.
      this.windowTriggered = false;
      this.windowLine = 0;
      this.locks = OAM_READ;
      this.oamScanSignal = true;
      this.setMode(PpuMode.OamScan);
      return;
    }
    this.ly = line;
    this.lyCompare = false;
    if (line < SCREEN_HEIGHT) {
      this.locks = OAM_READ;
      this.oamScanSignal = true;
      this.updateStatLine();
    } else if (line === SCREEN_HEIGHT) {
      // On a DMG the mode 2 source also fires as VBlank starts, as if line 144 began an
      // OAM scan.
      this.oamScanSignal = true;
      this.updateStatLine();
      this.oamScanSignal = false;
      this.setMode(PpuMode.VBlank);
      this.interrupts.request(Interrupt.VBlank);
      this.presentFrame();
    } else {
      this.updateStatLine();
    }
  }

  private visibleLineTick(): void {
    const dot = this.dot;
    if (dot === LINE_SETTLE) {
      this.locks |= OAM_WRITE;
      this.compareLy();
      if (this.mode === PpuMode.HBlank) this.setMode(PpuMode.OamScan);
    } else if (dot === OAM_SCAN_END && !this.lcdOnLine) {
      this.locks = OAM_READ | VRAM_READ;
    } else if (dot === DRAWING_START) {
      this.locks = ALL_LOCKS;
      this.oamScanSignal = false;
      this.setMode(PpuMode.Drawing);
      this.renderLine();
    } else if (this.mode === PpuMode.Drawing) {
      const end = DRAWING_END + this.drawingPenalty;
      if (!this.hblankSignal && dot >= end - HBLANK_IRQ_LEAD) {
        this.hblankSignal = true;
        this.updateStatLine();
      }
      if (dot >= end) {
        this.locks = 0;
        this.setMode(PpuMode.HBlank);
      }
    }
  }

  /**
   * Line 153: LY reads 153 for one M-cycle, then 0. The LY=LYC flag compares against 153
   * and then, after a gap, against 0, so LYC=0 matches here rather than on line 0.
   */
  private lastLineTick(): void {
    switch (this.dot) {
      case 4:
        this.lyCompare = this.lyc === this.line;
        this.ly = 0;
        break;
      case 8:
        this.lyCompare = false;
        break;
      case 12:
        this.lyCompare = this.lyc === 0;
        break;
      default:
        return;
    }
    this.updateStatLine();
  }

  private compareLy(): void {
    this.lyCompare = this.ly === this.lyc;
    this.updateStatLine();
  }

  readStat(): number {
    const coincidence = this.lyCompare ? 0x04 : 0;
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
      this.ly = this.line = this.dot = 0;
      this.mode = PpuMode.HBlank;
      this.locks = 0;
      this.oamScanSignal = this.hblankSignal = false;
      this.backShades.fill(0);
      this.presentFrame();
    } else if (!wasOn && this.lcdOn) {
      this.dot = 4;
      this.lcdOnLine = true;
      this.windowTriggered = false;
      this.windowLine = 0;
      this.compareLy();
    }
  }

  writeLyc(value: number): void {
    this.lyc = value;
    if (this.lcdOn) this.compareLy();
  }

  private setMode(mode: PpuModeId): void {
    this.mode = mode;
    if (mode !== PpuMode.HBlank) this.hblankSignal = false;
    this.updateStatLine();
  }

  /** STAT interrupts fire on the rising edge of the OR of all enabled sources. */
  private updateStatLine(): void {
    if (!this.lcdOn) return;
    const s = this.statSources;
    const line =
      ((s & 0x40) !== 0 && this.lyCompare) ||
      ((s & 0x08) !== 0 && (this.mode === PpuMode.HBlank || this.hblankSignal)) ||
      ((s & 0x10) !== 0 && this.mode === PpuMode.VBlank) ||
      ((s & 0x20) !== 0 && this.oamScanSignal);
    if (line && !this.statLine) this.interrupts.request(Interrupt.Stat);
    this.statLine = line;
  }

  writeState(w: StateWriter): void {
    w.bytes(this.vram);
    w.bytes(this.oam);
    w.bytes(this.backShades);
    w.bytes(this.frontShades);
    w.u8(this.lcdc);
    w.u8(this.scy);
    w.u8(this.scx);
    w.u8(this.ly);
    w.u8(this.lyc);
    w.u8(this.bgp);
    w.u8(this.obp0);
    w.u8(this.obp1);
    w.u8(this.wy);
    w.u8(this.wx);
    w.u8(this.statSources);
    w.u8(this.mode);
    w.u8(this.line);
    w.u16(this.dot);
    w.u8(this.locks);
    w.bool(this.oamScanSignal);
    w.bool(this.lcdOnLine);
    w.bool(this.statLine);
    w.bool(this.lyCompare);
    w.bool(this.hblankSignal);
    w.u8(this.drawingPenalty);
    w.bool(this.windowTriggered);
    w.u8(this.windowLine);
    w.u32(this.frameCount);
  }

  readState(r: StateReader): void {
    r.bytes(this.vram);
    r.bytes(this.oam);
    r.bytes(this.backShades);
    r.bytes(this.frontShades);
    this.lcdc = r.u8();
    this.scy = r.u8();
    this.scx = r.u8();
    this.ly = r.u8();
    this.lyc = r.u8();
    this.bgp = r.u8();
    this.obp0 = r.u8();
    this.obp1 = r.u8();
    this.wy = r.u8();
    this.wx = r.u8();
    this.statSources = r.u8() & 0x78;
    this.mode = (r.u8() & 3) as PpuModeId;
    this.line = r.u8();
    this.dot = r.u16();
    this.locks = r.u8() & ALL_LOCKS;
    this.oamScanSignal = r.bool();
    this.lcdOnLine = r.bool();
    this.statLine = r.bool();
    this.lyCompare = r.bool();
    this.hblankSignal = r.bool();
    this.drawingPenalty = r.u8();
    this.windowTriggered = r.bool();
    this.windowLine = r.u8();
    this.frameCount = r.u32();
    this.colorFrame();
  }

  private presentFrame(): void {
    this.frontShades.set(this.backShades);
    this.colorFrame();
    this.frameCount++;
  }

  private colorFrame(): void {
    const { framePixels, frontShades, colors } = this;
    for (let i = 0; i < frontShades.length; i++) framePixels[i] = colors[frontShades[i]!]!;
  }

  private renderLine(): void {
    const { lcdc, ly, bgIndex } = this;
    if (!this.windowTriggered && ly === this.wy) this.windowTriggered = true;
    let penalty = this.scx & 7;

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
        penalty += WINDOW_PENALTY;
      }
    } else {
      bgIndex.fill(0);
    }

    this.objColor.fill(0);
    if (lcdc & 0x02) penalty += this.renderSprites();
    this.drawingPenalty = penalty;

    const shades = this.backShades;
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
      shades[row + x] = shade;
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

  /** Draws this line's sprites; returns how many dots fetching them adds to mode 3. */
  private renderSprites(): number {
    const { oam, vram, ly } = this;
    const height = this.lcdc & 0x04 ? 16 : 8;
    const sprites = this.lineSprites;
    sprites.length = 0;
    for (let i = 0; i < 40 && sprites.length < MAX_SPRITES_PER_LINE; i++) {
      const top = oam[i * 4]! - 16;
      if (ly >= top && ly < top + height) sprites.push(i);
    }
    // DMG priority: smaller X wins, then lower OAM index. That is also the order they are
    // fetched in. Draw lowest priority first so the winner's opaque pixels end up on top.
    sprites.sort((a, b) => oam[a * 4 + 1]! - oam[b * 4 + 1]! || a - b);
    const penalty = this.spritePenalty();
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
    return penalty;
  }

  /**
   * Pan Docs' model: 6 dots per sprite fetched, plus up to 5 more while the background
   * fetch of the tile under the sprite's left edge finishes, once per tile. Sprites past the
   * right edge (X >= 168) aren't fetched. Expects {@link lineSprites} in fetch order.
   */
  private spritePenalty(): number {
    const { oam, lineSprites } = this;
    const fineScroll = this.scx & 7;
    let penalty = 0;
    let lastTile = -1;
    for (const sprite of lineSprites) {
      const x = oam[sprite * 4 + 1]!;
      if (x >= SCREEN_WIDTH + 8) continue;
      penalty += 6;
      const tile = (x + fineScroll) >> 3;
      if (tile !== lastTile) {
        penalty += Math.max(0, 5 - ((x + fineScroll) & 7));
        lastTile = tile;
      }
    }
    return penalty;
  }
}
