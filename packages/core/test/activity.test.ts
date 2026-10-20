import { describe, expect, it } from 'vitest';
import { GameBoy } from '../src';
import { makeRom } from './helpers/rom-builder';

describe('GameBoy.takeActivity', () => {
  it('counts bus traffic by region, and starts afresh each time', () => {
    const gb = new GameBoy(
      makeRom([
        ...[0x3e, 0xc0, 0xe0, 0x46], // LD A,$C0; LDH (DMA),A — copy sprites from work RAM
        ...[0x3e, 0x81, 0xe0, 0x02], // LD A,$81; LDH (SC),A — start a link transfer
        ...[0xfa, 0x00, 0xc0], // loop: LD A,($C000)
        ...[0xea, 0x00, 0x80], // LD ($8000),A
        ...[0xea, 0x00, 0x20], // LD ($2000),A — an MBC command
        ...[0x18, 0xf5], // JR loop
      ]),
    );
    gb.runFrame();
    const activity = gb.takeActivity();
    expect(activity.cycles).toBeGreaterThan(60_000);
    expect(activity.idleCycles).toBe(0);
    expect(activity.wramReads).toBeGreaterThan(1000);
    expect(activity.vramWrites).toBe(activity.wramReads);
    expect(activity.mbcWrites).toBe(activity.wramReads);
    // Every instruction byte is fetched from ROM.
    expect(activity.romReads).toBeGreaterThan(activity.wramReads * 10);
    expect(activity).toMatchObject({ wramWrites: 0, dmaTransfers: 1, serialTransfers: 1 });

    expect(gb.takeActivity()).toMatchObject({ cycles: 0, romReads: 0, dmaTransfers: 0 });
  });

  it('tells a halted CPU from a busy one', () => {
    const gb = new GameBoy(
      makeRom([
        ...[0xaf, 0xe0, 0xff], // XOR A; LDH (IE),A — no interrupt will wake it
        ...[0x76, 0x18, 0xfd], // halt: HALT; JR halt
      ]),
    );
    gb.runFrame();
    const { cycles, idleCycles } = gb.takeActivity();
    expect(idleCycles / cycles).toBeGreaterThan(0.99);
  });
});
