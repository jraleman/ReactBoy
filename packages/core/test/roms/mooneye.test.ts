import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inColorMode, loadRom, romPath, runMooneyeRom } from '../helpers/roms';

/**
 * Whether a test applies to what ReactBoy emulates: a DMG (revision A-C) started without a
 * boot ROM. Suffixes name the models a test is for; "G" means every DMG revision, and a
 * test without one runs on all models.
 */
function forDmg(path: string): boolean {
  const models = /-(\w+)\.gb$/.exec(path)?.[1];
  return models === undefined || models.includes('G') || models.startsWith('dmgABC');
}

const dir = romPath('mooneye');
const roms = dir
  ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.gb') && forDmg(path))
      .sort()
  : [];

describe.skipIf(!dir)('mooneye', () => {
  for (const rom of roms) {
    it(rom, () => {
      expect(runMooneyeRom(loadRom(`${dir}/${rom}`), 60 * 20)).toBeNull();
    });
  }
});

/**
 * Tests of Game Boy Color hardware whose subject is the same in color mode. Mooneye runs
 * them in DMG compatibility mode, which ReactBoy doesn't emulate, so their headers are
 * switched to color mode. The other CGB tests check register values that differ by mode.
 */
const COLOR_MODE = ['misc/ppu/vblank_stat_intr-C.gb'];

describe.skipIf(!dir)('mooneye, in Game Boy Color mode', () => {
  for (const rom of COLOR_MODE) {
    it(rom, () => {
      const image = inColorMode(loadRom(`${dir}/${rom}`));
      expect(runMooneyeRom(image, 60 * 20, 'cgb')).toBeNull();
    });
  }
});
