import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const ROMS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../roms/test');

/** A downloaded test ROM (`pnpm fetch-roms`), or null if it is missing. */
export function testRom(relative: string): string | null {
  const path = join(ROMS_DIR, relative);
  return existsSync(path) ? path : null;
}

export const readTestFile = (path: string) => new Uint8Array(readFileSync(path));

/** A valid 32 KiB ROM with `program` at the 0x0100 entry point. */
export function makeRom(program: number[], title: string): Buffer {
  const rom = Buffer.alloc(0x8000);
  rom.set(program, 0x100);
  rom.write(title, 0x134, 'ascii');
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}

/**
 * Turns the whole screen black while A is held and lightest otherwise: the screen shows
 * tile 0 (blank), so BGP alone picks its shade.
 */
export const INPUT_ROM = makeRom(
  [
    ...[0x3e, 0x10, 0xe0, 0x00], // LD A,$10; LDH (P1),A — read the action buttons
    ...[0xf0, 0x00, 0xe6, 0x01], // loop: LDH A,(P1); AND $01 — A is bit 0, low when held
    ...[0x20, 0x04], // JR NZ,released
    ...[0x3e, 0xff, 0x18, 0x02], // LD A,$FF; JR show
    ...[0x3e, 0x00], // released: LD A,$00
    ...[0xe0, 0x47], // show: LDH (BGP),A
    ...[0x18, 0xf0], // JR loop
  ],
  'INPUT TEST',
);

export async function loadRom(page: Page, file: { name: string; buffer: Buffer } | string) {
  const input = page.locator('input[type=file][accept^=".gb"]');
  if (typeof file === 'string') await input.setInputFiles(file);
  else await input.setInputFiles({ ...file, mimeType: 'application/octet-stream' });
}

/** The game screen's pixels as RGBA. */
export async function screenPixels(page: Page): Promise<number[]> {
  return page
    .locator('canvas[aria-label$="game screen"]')
    .evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext('2d')!.getImageData(0, 0, 160, 144).data),
    );
}

/** Waits until the middle of the screen shows `rgb` (0xRRGGBB). */
export async function expectScreenColor(page: Page, rgb: number) {
  await expect
    .poll(async () => {
      const [r, g, b] = await page
        .locator('canvas[aria-label$="game screen"]')
        .evaluate((canvas: HTMLCanvasElement) =>
          Array.from(canvas.getContext('2d')!.getImageData(80, 72, 1, 1).data),
        );
      return ((r! << 16) | (g! << 8) | b!) >>> 0;
    })
    .toBe(rgb);
}
