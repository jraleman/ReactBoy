import { expect, it } from 'vitest';
import { GameBoy } from '../../src';
import { loadRom, romPath } from '../helpers/roms';
import { makeRom } from '../helpers/rom-builder';

// A busy loop keeps the CPU running every cycle (no HALT), the worst case for the core.
const busyLoop = makeRom([0x3c, 0x80, 0xa8, 0xcb, 0x37, 0x18, 0xf9]);
const acid2 = romPath('dmg-acid2/dmg-acid2.gb');

/** Budget from the design doc: under ~8 ms per frame on desktop. */
const BUDGET_MS = 8;

function measure(name: string, gb: GameBoy, frames = 600) {
  for (let i = 0; i < 60; i++) gb.runFrame(); // warm up the JIT
  const start = performance.now();
  for (let i = 0; i < frames; i++) gb.runFrame();
  const msPerFrame = (performance.now() - start) / frames;
  process.stdout.write(
    `${name}: ${msPerFrame.toFixed(3)} ms/frame (${(1000 / msPerFrame / 59.73).toFixed(1)}x real time)\n`,
  );
  expect(msPerFrame).toBeLessThan(BUDGET_MS);
}

it('busy CPU loop', () => measure('busy CPU loop', new GameBoy(busyLoop)));
it.skipIf(!acid2)('dmg-acid2', () => measure('dmg-acid2', new GameBoy(loadRom(acid2!))));
