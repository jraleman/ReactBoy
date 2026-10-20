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
