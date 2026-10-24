import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../constants';
import { Interrupt, type Interrupts } from '../interrupts';
import type { StateReader, StateWriter, Stateful } from '../state';
import { cgbColorTable, PALETTES, toAbgr, type ColorCorrection, type Palette } from './palette';

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
/** The 15-bit color white, and the mask of a color's bits. */
const WHITE = 0x7fff;

/** The bytes of a typed array, for saving it. */
const bytesOf = (array: Uint16Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/**
 * Pixel processing unit, rendering one scanline at a time when mode 3 begins. Mode timing,
 * LY/LYC and STAT interrupts are dot-accurate to the M-cycle, including how scrolling,
 * sprites and the window lengthen mode 3; mid-scanline register writes are not reflected
 * (that needs a pixel FIFO). A Game Boy Color's PPU adds palette RAM, tile attributes in
 * VRAM bank 1 and its own sprite priority rules.
 */
export class Ppu implements Stateful {
  /** VRAM: two 8 KiB banks, of which a DMG has only the first. */
  readonly vram = new Uint8Array(0x4000);
  readonly oam = new Uint8Array(0xa0);
  /**
   * Game Boy Color palette RAM: 8 palettes of four little-endian 15-bit colors each, for
   * the background and for sprites. Both start white, as the boot ROM leaves the background
   * ones; sprite palettes power up with arbitrary contents.
   */
  readonly bgPalettes = new Uint8Array(64).fill(0xff);
  readonly objPalettes = new Uint8Array(64).fill(0xff);
  /** Last completed frame, RGBA. */
  readonly framebuffer = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  /** Completed frames since power-on; bumps at the start of VBlank. */
  frameCount = 0;
  /** Called as mode 0 starts on each visible line; HBlank DMA copies then. */
  onHblank: (() => void) | null = null;

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
  /** BCPS and OCPS: the palette RAM byte BCPD and OCPD reach, and bit 7 to step after writes. */
  private bcps = 0;
  private ocps = 0;
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
  /**
   * The Game Boy Color's equivalent of the shades: each pixel's 15-bit color, taken from
   * palette RAM as the line was drawn so that palettes rewritten mid-frame show.
   */
  private readonly backColors = new Uint16Array(SCREEN_WIDTH * SCREEN_HEIGHT).fill(WHITE);
  private readonly frontColors = new Uint16Array(SCREEN_WIDTH * SCREEN_HEIGHT).fill(WHITE);
  private cgbColors = cgbColorTable('lcd');
  /** Map attributes only exist on a Game Boy Color; this keeps them at 0 on a DMG. */
  private readonly attrMask: number;
  private readonly bgIndex = new Uint8Array(SCREEN_WIDTH);
  private readonly bgAttr = new Uint8Array(SCREEN_WIDTH);
  private readonly objColor = new Uint8Array(SCREEN_WIDTH);
  private readonly objAttr = new Uint8Array(SCREEN_WIDTH);
  private readonly lineSprites: number[] = [];

  constructor(
    private readonly interrupts: Interrupts,
    private readonly cgb = false,
  ) {
    this.attrMask = cgb ? 0xff : 0;
    this.setPalette(PALETTES.classic);
  }

  /** The DMG's four shades. Also recolors the last completed frame; a Game Boy Color ignores it. */
  setPalette(palette: Palette): void {
    palette.forEach((rgb, i) => (this.colors[i] = toAbgr(rgb)));
    this.colorFrame();
  }

  /** How a Game Boy Color's colors are shown. Also recolors the last completed frame. */
  setColorCorrection(correction: ColorCorrection): void {
    this.cgbColors = cgbColorTable(correction);
    this.colorFrame();
  }

  /** BCPS (or OCPS for sprites). */
  readPaletteIndex(obj: boolean): number {
    return 0x40 | (obj ? this.ocps : this.bcps);
  }

  writePaletteIndex(obj: boolean, value: number): void {
    if (obj) this.ocps = value & 0xbf;
    else this.bcps = value & 0xbf;
  }

  /** BCPD (or OCPD): palette RAM is out of reach while VRAM is. */
  readPaletteData(obj: boolean): number {
    if (!this.vramReadable()) return 0xff;
    return obj ? this.objPalettes[this.ocps & 0x3f]! : this.bgPalettes[this.bcps & 0x3f]!;
  }

  /** A blocked write is dropped, but the index still steps. */
  writePaletteData(obj: boolean, value: number): void {
    const index = obj ? this.ocps : this.bcps;
    if (this.vramWritable()) (obj ? this.objPalettes : this.bgPalettes)[index & 0x3f] = value;
    if ((index & 0x80) === 0) return;
    const next = 0x80 | ((index + 1) & 0x3f);
    if (obj) this.ocps = next;
    else this.bcps = next;
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

  /**
   * Advances `dots`: an M-cycle's 4, or 2 for a double-speed one. Lines are timed in
   * multiples of 4 dots, which either step lands on.
   */
  tick(dots = 4): void {
    if (!this.lcdOn) return;
    this.dot += dots;
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
        if (this.onHblank !== null) this.onHblank();
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
      this.backColors.fill(WHITE);
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
    if (this.cgb) {
      w.bytes(bytesOf(this.backColors));
      w.bytes(bytesOf(this.frontColors));
    } else {
      w.bytes(this.backShades);
      w.bytes(this.frontShades);
    }
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
    if (this.cgb) {
      w.bytes(this.bgPalettes);
      w.bytes(this.objPalettes);
      w.u8(this.bcps);
      w.u8(this.ocps);
    }
  }

  readState(r: StateReader): void {
    if (r.version < 3) {
      // Version 2 states predate the second bank.
      r.bytes(this.vram.subarray(0, 0x2000));
      this.vram.fill(0, 0x2000);
    } else {
      r.bytes(this.vram);
    }
    r.bytes(this.oam);
    if (this.cgb) {
      r.bytes(bytesOf(this.backColors));
      r.bytes(bytesOf(this.frontColors));
    } else {
      r.bytes(this.backShades);
      r.bytes(this.frontShades);
    }
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
    if (this.cgb) {
      r.bytes(this.bgPalettes);
      r.bytes(this.objPalettes);
      this.bcps = r.u8() & 0xbf;
      this.ocps = r.u8() & 0xbf;
    }
    this.colorFrame();
  }

  private presentFrame(): void {
    if (this.cgb) this.frontColors.set(this.backColors);
    else this.frontShades.set(this.backShades);
    this.colorFrame();
    this.frameCount++;
  }

  private colorFrame(): void {
    const { framePixels } = this;
    if (this.cgb) {
      const { frontColors, cgbColors } = this;
      for (let i = 0; i < frontColors.length; i++) framePixels[i] = cgbColors[frontColors[i]!]!;
    } else {
      const { frontShades, colors } = this;
      for (let i = 0; i < frontShades.length; i++) framePixels[i] = colors[frontShades[i]!]!;
    }
  }

  private renderLine(): void {
    const { lcdc, ly, bgIndex } = this;
    if (!this.windowTriggered && ly === this.wy) this.windowTriggered = true;
    let penalty = this.scx & 7;

    // On a DMG, LCDC bit 0 off blanks both background and window to color 0. A Game Boy
    // Color draws them regardless; the bit takes away their priority over sprites instead.
    if (this.cgb || lcdc & 0x01) {
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

    if (this.cgb) this.colorLine(ly * SCREEN_WIDTH);
    else this.shadeLine(ly * SCREEN_WIDTH);
  }

  /** DMG: each pixel's shade through BGP, OBP0 or OBP1. */
  private shadeLine(row: number): void {
    const { bgIndex, bgp } = this;
    const shades = this.backShades;
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

  /** Game Boy Color: each pixel's color from palette RAM. */
  private colorLine(row: number): void {
    const { bgIndex, bgAttr, objColor, objAttr, bgPalettes, objPalettes, backColors } = this;
    const bgPriority = (this.lcdc & 0x01) !== 0;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const bg = bgIndex[x]!;
      const obj = objColor[x]!;
      let palettes = bgPalettes;
      let entry = ((bgAttr[x]! & 7) << 3) | (bg << 1);
      // Bit 7 of either the map attribute or the sprite's puts background colors 1-3 on top.
      if (obj !== 0 && (bg === 0 || !bgPriority || ((bgAttr[x]! | objAttr[x]!) & 0x80) === 0)) {
        palettes = objPalettes;
        entry = ((objAttr[x]! & 7) << 3) | (obj << 1);
      }
      backColors[row + x] = (palettes[entry]! | (palettes[entry + 1]! << 8)) & WHITE;
    }
  }

  /**
   * Fills bgIndex and bgAttr [from, to) from a 32x32 tile map. On a Game Boy Color each map
   * entry has an attribute byte at the same address in bank 1: palette (bits 0-2), tile
   * bank (3), horizontal and vertical flip (5, 6) and priority over sprites (7).
   * @param y row within the map, in pixels
   * @param xOffset map x of screen x=0
   */
  private fetchTiles(highMap: boolean, y: number, from: number, to: number, xOffset: number): void {
    const { vram, attrMask, bgIndex, bgAttr } = this;
    const unsignedTiles = (this.lcdc & 0x10) !== 0;
    const rowBase = (highMap ? 0x1c00 : 0x1800) + (y >> 3) * 32;
    let column = -1;
    let attr = 0;
    let lo = 0;
    let hi = 0;
    for (let x = from; x < to; x++) {
      const mapX = (x + xOffset) & 0xff;
      if (mapX >> 3 !== column) {
        column = mapX >> 3;
        const entry = rowBase + column;
        const tile = vram[entry]!;
        attr = vram[0x2000 + entry]! & attrMask;
        const tileRow = attr & 0x40 ? 7 - (y & 7) : y & 7;
        const addr =
          (attr & 0x08 ? 0x2000 : 0) +
          (unsignedTiles ? tile * 16 : 0x1000 + ((tile << 24) >> 24) * 16) +
          tileRow * 2;
        lo = vram[addr]!;
        hi = vram[addr + 1]!;
      }
      const bit = attr & 0x20 ? mapX & 7 : 7 - (mapX & 7);
      bgIndex[x] = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
      bgAttr[x] = attr;
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
    // Sprites are fetched in X order, then OAM order. That is also DMG priority; a Game Boy
    // Color goes by OAM index alone. Draw lowest priority first so the winner's opaque
    // pixels end up on top.
    sprites.sort((a, b) => oam[a * 4 + 1]! - oam[b * 4 + 1]! || a - b);
    const penalty = this.spritePenalty();
    if (this.cgb) sprites.sort((a, b) => a - b);
    for (let s = sprites.length - 1; s >= 0; s--) {
      const base = sprites[s]! * 4;
      const left = oam[base + 1]! - 8;
      const attr = oam[base + 3]!;
      let row = ly - (oam[base]! - 16);
      if (attr & 0x40) row = height - 1 - row;
      const tile = height === 16 ? oam[base + 2]! & 0xfe : oam[base + 2]!;
      // On a Game Boy Color, bit 3 picks the tile's VRAM bank and bits 0-2 the palette.
      const bank = this.cgb && attr & 0x08 ? 0x2000 : 0;
      const addr = bank + tile * 16 + row * 2;
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
