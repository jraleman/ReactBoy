import { expect, it } from 'vitest';
import { GameBoy, SCREEN_HEIGHT, SCREEN_WIDTH } from '../../src';
import { loadRom, romPath } from '../helpers/roms';

const hblankDma = romPath('magen/hblank_vram_dma.gbc');

/** Counts each 0xRRGGBB color on screen. */
function screenColors(gb: GameBoy): Map<number, number> {
  const fb = gb.framebuffer;
  const counts = new Map<number, number>();
  for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
    const rgb = (fb[i * 4]! << 16) | (fb[i * 4 + 1]! << 8) | fb[i * 4 + 2]!;
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  }
  return counts;
}

// Red if the first HBlank DMA didn't finish, blue if the second one ran while halted.
it.skipIf(!hblankDma)('hblank_vram_dma: HBlank DMA completes, and pauses during HALT', () => {
  const gb = new GameBoy(loadRom(hblankDma!), { model: 'cgb', colorCorrection: 'raw' });
  for (let frame = 0; frame < 60; frame++) gb.runFrame();
  expect(screenColors(gb)).toEqual(new Map([[0x00ff00, SCREEN_WIDTH * SCREEN_HEIGHT]]));
});
