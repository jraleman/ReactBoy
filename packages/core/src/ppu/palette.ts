/** Four colors as 0xRRGGBB, lightest (shade 0) to darkest (shade 3). */
export type Palette = readonly [number, number, number, number];

export const PALETTES = {
  /** The pea-soup LCD of the original DMG. */
  classic: [0x9bbc0f, 0x8bac0f, 0x306230, 0x0f380f],
  /** Game Boy Pocket-style neutral greys. */
  grey: [0xe0e0e0, 0xa8a8a8, 0x606060, 0x181818],
  /** Pure greyscale, matching the test-ROM reference images. */
  mono: [0xffffff, 0xaaaaaa, 0x555555, 0x000000],
  /** Soft greens popularised by many emulators. */
  mint: [0xe0f8d0, 0x88c070, 0x346856, 0x081820],
} as const satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

/** Converts 0xRRGGBB to the little-endian 0xAABBGGRR layout of an RGBA Uint32Array view. */
export function toAbgr(rgb: number): number {
  return (0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
}

/** How a Game Boy Color's 15-bit colors become screen colors. */
export type ColorCorrection = 'lcd' | 'raw';

const cgbColorTables: Partial<Record<ColorCorrection, Uint32Array>> = {};

/**
 * Every 15-bit Game Boy Color color (0bBBBBBGGGGGRRRRR) in the RGBA Uint32Array layout of
 * {@link toAbgr}. 'raw' scales each channel to 8 bits. 'lcd' mixes the channels as the
 * handheld's dim, washed-out screen does, using Gambatte's model stretched so white stays
 * white; games were designed against that screen, so raw colors look oversaturated.
 */
export function cgbColorTable(correction: ColorCorrection): Uint32Array {
  const cached = cgbColorTables[correction];
  if (cached) return cached;
  const table = new Uint32Array(0x8000);
  for (let color = 0; color < table.length; color++) {
    const r = color & 0x1f;
    const g = (color >> 5) & 0x1f;
    const b = color >> 10;
    let rgb: number;
    if (correction === 'raw') {
      const scale = (c: number) => (c << 3) | (c >> 2);
      rgb = (scale(r) << 16) | (scale(g) << 8) | scale(b);
    } else {
      // Each mix reaches 496 (= 31 * 16) for white.
      const stretch = (mix: number) => Math.round((mix * 255) / 496);
      rgb =
        (stretch(r * 13 + g * 2 + b) << 16) |
        (stretch(g * 12 + b * 4) << 8) |
        stretch(r * 3 + g * 2 + b * 11);
    }
    table[color] = toAbgr(rgb);
  }
  cgbColorTables[correction] = table;
  return table;
}
