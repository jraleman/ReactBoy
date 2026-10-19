import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadRom, romPath, runMooneyeRom } from '../helpers/roms';

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
