import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GameBoy, PALETTES, SCREEN_HEIGHT, SCREEN_WIDTH } from '../../src';
import { decodeGreyscalePng, loadRom, romPath } from '../helpers/roms';

const rom = romPath('dmg-acid2/dmg-acid2.gb');
const reference = romPath('dmg-acid2/reference-dmg.png');

it.skipIf(!rom || !reference)('dmg-acid2 matches the reference image', () => {
  const gb = new GameBoy(loadRom(rom!), { palette: PALETTES.mono });
  for (let frame = 0; frame < 120; frame++) gb.runFrame();

  const expected = decodeGreyscalePng(new Uint8Array(readFileSync(reference!)));
  expect(expected.width).toBe(SCREEN_WIDTH);
  expect(expected.height).toBe(SCREEN_HEIGHT);

  const mismatches: string[] = [];
  for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
    const actual = gb.framebuffer[i * 4]!;
    if (actual !== expected.pixels[i]) {
      mismatches.push(`(${i % SCREEN_WIDTH},${Math.floor(i / SCREEN_WIDTH)})`);
    }
  }
  expect(mismatches.length, `first mismatches: ${mismatches.slice(0, 10).join(' ')}`).toBe(0);
});
