import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { GameBoy } from '../../src';

const ROMS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../roms/test');

/** Path of a downloaded test ROM, or null if `pnpm fetch-roms` hasn't been run. */
export function romPath(relative: string): string | null {
  const path = join(ROMS_DIR, relative);
  return existsSync(path) ? path : null;
}

export function loadRom(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/**
 * Runs a Blargg-style ROM that reports over the serial port until it prints
 * "Passed"/"Failed" or the frame budget runs out. Returns everything it printed.
 */
export function runSerialRom(rom: Uint8Array, maxFrames: number): string {
  const gb = new GameBoy(rom);
  let output = '';
  gb.serial.onByte = (byte) => {
    output += String.fromCharCode(byte);
  };
  for (let frame = 0; frame < maxFrames; frame++) {
    gb.runFrame();
    if (/Passed|Failed/.test(output)) break;
  }
  return output;
}

/**
 * Decodes a non-interlaced greyscale PNG (any bit depth up to 8) into one value per pixel,
 * scaled to 0-255. Enough for the test-ROM reference images without a PNG dependency.
 */
export function decodeGreyscalePng(file: Uint8Array): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  const idat: Uint8Array[] = [];
  while (offset < file.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8));
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = data[8]!;
      if (data[9] !== 0 || data[12] !== 0)
        throw new Error('Only non-interlaced greyscale PNGs are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * depth) / 8);
  const bpp = Math.max(1, depth / 8);
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= bpp ? rows[y * stride + x - bpp]! : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const upLeft = x >= bpp && y > 0 ? rows[(y - 1) * stride + x - bpp]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      rows[y * stride + x] = value + predictor;
    }
  }
  const max = (1 << depth) - 1;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const byte = rows[y * stride + (bit >> 3)]!;
      const value = (byte >> (8 - depth - (bit & 7))) & max;
      pixels[y * width + x] = Math.round((value * 255) / max);
    }
  }
  return { width, height, pixels };
}
