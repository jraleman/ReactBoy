import { describe, expect, it } from 'vitest';
import { parseHeader, type DebugSnapshot } from '@reactboy/core';
import {
  measuredClock,
  PARTS,
  tilesInUse,
  usedShare,
  visibleSprites,
  type ReadoutContext,
} from './parts';

const snapshot = (patch: Partial<DebugSnapshot> = {}): DebugSnapshot => ({
  af: 0,
  bc: 0,
  de: 0,
  hl: 0,
  sp: 0xcff0,
  pc: 0x150,
  ime: false,
  cpu: 'running',
  romBank: 1,
  cycles: 0,
  frame: 0,
  memory: new Uint8Array(0x10000),
  ...patch,
});

const context = (patch: Partial<ReadoutContext> = {}): ReadoutContext => ({
  status: 'running',
  header: null,
  link: 'off',
  speed: 1,
  fps: 60,
  snapshot: snapshot(),
  previous: null,
  elapsed: 0,
  ...patch,
});

const part = (id: string) => PARTS.find((p) => p.id === id)!;

describe('part readouts', () => {
  it('measures the clock between two looks, only while running', () => {
    const live = context({
      previous: snapshot({ cycles: 1_000_000 }),
      snapshot: snapshot({ cycles: 1_419_430 }),
      elapsed: 100,
    });
    expect(measuredClock(live)).toBeCloseTo(4_194_300);
    expect(measuredClock({ ...live, status: 'paused' })).toBeNull();
    // Across a reset the count goes backwards.
    expect(measuredClock({ ...live, previous: snapshot({ cycles: 2e6 }) })).toBeNull();
  });

  it('counts used memory, drawn tiles and on-screen sprites', () => {
    const memory = new Uint8Array(0x10000);
    memory[0xc000] = 1;
    memory[0xc001] = 2;
    memory[0x8000 + 5 * 16 + 3] = 0xff; // tile 5
    memory[0x9000 + 2] = 0x01; // tile 256
    memory.set([16, 8], 0xfe00); // sprite 0 at the top left
    memory.set([0, 50], 0xfe04); // sprite 1 hidden above the screen
    expect(usedShare(memory, 0xc000, 0xc004)).toBe(0.5);
    expect(tilesInUse(memory)).toBe(2);
    expect(visibleSprites(memory)).toBe(1);
  });

  it('describes the cartridge and its mapped bank', () => {
    const rom = new Uint8Array(0x10000);
    rom.set(
      [...'BANKS'].map((c) => c.charCodeAt(0)),
      0x134,
    );
    rom[0x147] = 0x03; // MBC1+RAM+BATTERY
    rom[0x148] = 0x01; // 64 KiB
    rom[0x149] = 0x02; // 8 KiB RAM
    const header = parseHeader(rom);
    expect(part('cartridge').read(context({ header, snapshot: snapshot({ romBank: 3 }) }))).toEqual(
      [
        ['Game', 'BANKS'],
        ['Type', 'MBC1+RAM+BATTERY'],
        ['ROM', '64 KiB in 4 banks'],
        ['Bank in view', '3 of 4'],
        ['Save RAM', '8 KiB, battery-backed'],
      ],
    );
    expect(part('cartridge').read(context())).toEqual([['Slot', 'Empty']]);
  });

  it('reads the LCD and sound registers', () => {
    const memory = new Uint8Array(0x10000);
    memory[0xff40] = 0x80; // LCD on, nothing else
    memory[0xff41] = 0x03; // drawing
    memory[0xff44] = 42;
    memory[0xff26] = 0x85; // sound on, pulse 1 and wave
    memory[0xff24] = 0x73;
    const live = context({ snapshot: snapshot({ memory, frame: 1234 }) });
    expect(part('lcd').read(live)).toEqual([
      ['Mode', 'Drawing'],
      ['Line (LY)', '42'],
      ['Frame', '1,234'],
      ['Scroll', '0, 0'],
      ['Window', 'Off'],
      ['Sprites', 'Off'],
    ]);
    expect(part('sound').read(live)).toEqual([
      ['Channels on', 'Pulse 1, Wave'],
      ['Volume', 'Left 8/8, right 4/8'],
    ]);
  });

  it('asks for a game where there is nothing to read', () => {
    for (const id of ['lcd', 'wram', 'vram', 'cpu', 'sound']) {
      expect(part(id).read(context({ snapshot: null }))).toEqual([
        ['Status', 'Load a game to see it work'],
      ]);
    }
    // The cable's state is known without a game.
    expect(part('link').read(context({ snapshot: null, link: 'waiting' }))).toEqual([
      ['Cable', 'Waiting for a partner'],
      ['Status', 'Load a game to see it work'],
    ]);
  });
});
