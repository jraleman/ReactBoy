import { describe, expect, it } from 'vitest';
import type { BusActivity } from '@reactboy/core';
import { boardActivity, IDLE } from './activity';

/** A tenth of a second of a machine doing nothing in particular. */
const report = (patch: Partial<BusActivity> = {}): BusActivity => ({
  cycles: 400_000,
  idleCycles: 0,
  romReads: 0,
  mbcWrites: 0,
  vramReads: 0,
  vramWrites: 0,
  cartRamReads: 0,
  cartRamWrites: 0,
  wramReads: 0,
  wramWrites: 0,
  dmaTransfers: 0,
  serialTransfers: 0,
  lcdc: 0,
  nr52: 0,
  sc: 0,
  ...patch,
});

describe('boardActivity', () => {
  it('is dark with no game, or nothing measured yet', () => {
    expect(boardActivity('empty', report())).toEqual(IDLE);
    expect(boardActivity('running', null)).toEqual(IDLE);
    expect(boardActivity('running', report({ cycles: 0 }))).toEqual(IDLE);
  });

  it('lights buses by how often the CPU used them', () => {
    // 100,000 M-cycles: 8% of them on work RAM lights it fully, 2% on video RAM a quarter.
    const activity = boardActivity(
      'running',
      report({ wramReads: 4000, wramWrites: 4000, vramWrites: 500, romReads: 60_000 }),
    );
    expect(activity.wram).toBe(1);
    expect(activity.vram).toBeCloseTo(0.5);
    expect(activity.cart).toBe(1);
  });

  it('dims a halted CPU and follows DMA, bank switches and registers', () => {
    const activity = boardActivity(
      'paused',
      report({
        idleCycles: 300_000,
        dmaTransfers: 6,
        mbcWrites: 2,
        lcdc: 0x91,
        nr52: 0x83,
        serialTransfers: 1,
      }),
    );
    expect(activity.cpu).toBeCloseTo(0.475);
    expect(activity).toMatchObject({ wram: 0.5, cart: 1, lcd: 1, link: 1, clock: 1, power: 1 });
    expect(activity.sound).toBeCloseTo(0.7);
    expect(boardActivity('running', report({ nr52: 0x0f })).sound).toBe(0);
  });
});
