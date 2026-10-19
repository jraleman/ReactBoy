import { describe, expect, it } from 'vitest';
import { OamDma } from '../src/dma';

describe('OAM DMA', () => {
  it('blocks OAM from the first copy until the M-cycle after the last', () => {
    const oam = new Uint8Array(0xa0);
    const dma = new OamDma((addr) => (addr & 0xff) ^ 0x5a, oam);
    dma.start(0xc0);
    dma.tick(); // setup: OAM is still free
    expect(dma.active).toBe(false);
    dma.tick();
    expect([dma.active, oam[0]]).toEqual([true, 0x5a]);
    for (let i = 1; i < 160; i++) dma.tick();
    expect([dma.active, oam[159]]).toEqual([true, 159 ^ 0x5a]);
    dma.tick();
    expect(dma.active).toBe(false);
  });

  it('keeps OAM blocked through the setup cycle of a restart', () => {
    const dma = new OamDma(() => 0, new Uint8Array(0xa0));
    dma.start(0xc0);
    dma.tick();
    dma.tick();
    dma.start(0xc1);
    dma.tick();
    expect(dma.active).toBe(true);
  });
});
