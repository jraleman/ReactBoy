import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GameBoy, SCREEN_HEIGHT, SCREEN_WIDTH } from '../../src';
import { decodePng, loadRom, romPath } from '../helpers/roms';

const rom = romPath('cgb-acid2/cgb-acid2.gbc');
const reference = romPath('cgb-acid2/reference.png');

it.skipIf(!rom || !reference)('cgb-acid2 matches the reference image', () => {
  // The reference image scales each channel straight to 8 bits.
  const gb = new GameBoy(loadRom(rom!), { model: 'cgb', colorCorrection: 'raw' });
  for (let frame = 0; frame < 120; frame++) gb.runFrame();

  const expected = decodePng(new Uint8Array(readFileSync(reference!)));
  expect(expected.width).toBe(SCREEN_WIDTH);
  expect(expected.height).toBe(SCREEN_HEIGHT);

  const fb = gb.framebuffer;
  const mismatches: string[] = [];
  for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
    const actual = (fb[i * 4]! << 16) | (fb[i * 4 + 1]! << 8) | fb[i * 4 + 2]!;
    if (actual !== expected.pixels[i]) {
      mismatches.push(`(${i % SCREEN_WIDTH},${Math.floor(i / SCREEN_WIDTH)})`);
    }
  }
  expect(mismatches.length, `first mismatches: ${mismatches.slice(0, 10).join(' ')}`).toBe(0);
});
