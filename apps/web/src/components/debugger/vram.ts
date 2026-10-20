import { toAbgr, type Palette } from '@reactboy/core';

/**
 * The four colors that 2-bit color ids map to, as RGBA words for a Uint32Array view of
 * ImageData. `register` is a palette register (BGP/OBP0/OBP1); without one, ids map to
 * shades directly. `transparent` makes id 0 see-through, as for sprites.
 */
export function colorsFor(palette: Palette, register = 0xe4, transparent = false): Uint32Array {
  const colors = new Uint32Array(4);
  for (let id = 0; id < 4; id++) {
    colors[id] = transparent && id === 0 ? 0 : toAbgr(palette[(register >> (id * 2)) & 3]!);
  }
  return colors;
}

/** Address of tile `index` under LCDC bit 4: 0x8000 unsigned, or 0x9000 signed. */
export function tileAddress(lcdc: number, index: number): number {
  return lcdc & 0x10 ? 0x8000 + index * 16 : 0x9000 + ((index << 24) >> 24) * 16;
}

/**
 * Draws the 8x`height` tile at `addr` into `pixels` (an image `stride` pixels wide) with
 * its top-left at (x, y). Transparent pixels (color 0) are left untouched.
 */
export function drawTile(
  pixels: Uint32Array,
  stride: number,
  memory: Uint8Array,
  addr: number,
  x: number,
  y: number,
  colors: Uint32Array,
  { flipX = false, flipY = false, height = 8 } = {},
): void {
  for (let row = 0; row < height; row++) {
    const line = flipY ? height - 1 - row : row;
    const lo = memory[addr + line * 2]!;
    const hi = memory[addr + line * 2 + 1]!;
    for (let col = 0; col < 8; col++) {
      const bit = flipX ? col : 7 - col;
      const color = colors[(((hi >> bit) & 1) << 1) | ((lo >> bit) & 1)]!;
      if (color !== 0) pixels[(y + row) * stride + x + col] = color;
    }
  }
}

/** Paints `pixels` onto a canvas of the same size. */
export function paint(canvas: HTMLCanvasElement | null, pixels: Uint32Array<ArrayBuffer>): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const image = new ImageData(new Uint8ClampedArray(pixels.buffer), canvas.width, canvas.height);
  context.putImageData(image, 0, 0);
}
