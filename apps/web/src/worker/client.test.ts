import { describe, expect, it, vi } from 'vitest';
import { Button, GameBoy } from '@reactboy/core';
import { romKey } from '../storage/rom-key';
import { MemoryStore } from '../storage/store';
import { EmulatorClient } from './client';

/** A valid ROM header around `program` at 0x0100. */
function makeRom(program: number[], type = 0x00, ramSizeCode = 0x00): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom.set(program, 0x100);
  rom.set(
    [...'SAVES'].map((c) => c.charCodeAt(0)),
    0x134,
  );
  rom[0x147] = type;
  rom[0x149] = ramSizeCode;
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}

/** MBC1+RAM+BATTERY that writes 0x42 to 0xA000, then spins. */
const batteryRom = makeRom(
  [0x3e, 0x0a, 0xea, 0x00, 0x00, 0x3e, 0x42, 0xea, 0x00, 0xa0, 0x18, 0xfe],
  0x03,
  0x02,
);
const batteryKey = romKey(batteryRom.slice().buffer);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Loads a ROM and waits until the client has stored it. */
async function load(client: EmulatorClient, rom: Uint8Array) {
  await client.loadRom(new Blob([rom.slice()]));
  await vi.waitFor(() => expect(client.getSnapshot().recent.length).toBeGreaterThan(0));
}

/** Runs one frame while paused and waits for it. */
async function step(client: EmulatorClient) {
  client.stepFrame();
  await settle();
}

describe('EmulatorClient', () => {
  it('falls back to the main thread when workers are unavailable', () => {
    expect(new EmulatorClient({ store: new MemoryStore() }).getSnapshot()).toMatchObject({
      status: 'empty',
      inline: true,
    });
  });

  it('keeps a button held until every source releases it', () => {
    const client = new EmulatorClient({ store: new MemoryStore() });
    client.setButton('keyboard', Button.A, true);
    client.setButton('touch', Button.A, true);
    client.setButton('keyboard', Button.A, false);
    expect(client.getSnapshot().pressed).toBe(1 << Button.A);
    client.setButton('touch', Button.A, false);
    expect(client.getSnapshot().pressed).toBe(0);
  });

  it('reports unreadable files as an error state', async () => {
    const client = new EmulatorClient({ store: new MemoryStore() });
    await client.loadRom(new Blob([new Uint8Array(16)]));
    await settle();
    expect(client.getSnapshot()).toMatchObject({ status: 'error' });
    expect(client.getSnapshot().error).toMatch(/too small/);
    expect(client.getSnapshot().recent).toEqual([]);
  });
});

describe('EmulatorClient with a game loaded', () => {
  it('keeps playing when a bad file is loaded on top', async () => {
    const client = new EmulatorClient({ store: new MemoryStore() });
    await client.loadRom(new Blob([new Uint8Array(0x8000)]));
    await settle();
    expect(client.getSnapshot()).toMatchObject({ status: 'running', error: null });

    await client.loadRom(new Blob([new Uint8Array(16)]));
    await settle();
    expect(client.getSnapshot().status).toBe('running');
    expect(client.getSnapshot().header?.title).toBe('UNTITLED');
    expect(client.getSnapshot().error).toMatch(/too small/);
    client.dispose();
  });
});

describe('EmulatorClient saves', () => {
  it('stores the ROM for relaunching from the recent list', async () => {
    const store = new MemoryStore();
    const client = new EmulatorClient({ store });
    await load(client, batteryRom);
    expect(client.getSnapshot().recent).toMatchObject([{ id: batteryKey, title: 'SAVES' }]);
    client.dispose();

    const next = new EmulatorClient({ store });
    await vi.waitFor(() => expect(next.getSnapshot().recent).toHaveLength(1));
    await next.loadRecent(batteryKey);
    await vi.waitFor(() => expect(next.getSnapshot().header?.title).toBe('SAVES'));
    next.dispose();
  });

  it('persists battery RAM and resumes where the player left off', async () => {
    const store = new MemoryStore();
    const client = new EmulatorClient({ store });
    await load(client, batteryRom);
    client.pause();
    await step(client);
    await client.persist();
    const battery = await store.getBattery(batteryKey);
    expect(new Uint8Array(battery!.data)[0]).toBe(0x42);
    expect(await store.getState(batteryKey, 'auto')).not.toBeNull();
    client.dispose();

    const next = new EmulatorClient({ store });
    await load(next, batteryRom);
    expect(next.getSnapshot().notice).toBe('Resumed where you left off.');
    next.dispose();
  });

  it.each([
    ['resumes from a state newer than the battery save', 3, 'Resumed where you left off.'],
    ['does not resume from a state older than the battery save', 1, null],
  ])('%s', async (_, created, notice) => {
    const store = new MemoryStore();
    const data = new GameBoy(batteryRom).serialize().buffer as ArrayBuffer;
    await store.putState(batteryKey, { slot: 'auto', data, created, thumbnail: null });
    await store.putBattery(batteryKey, { data: new ArrayBuffer(0x2000), updated: 2 });
    const client = new EmulatorClient({ store });
    await load(client, batteryRom);
    expect(client.getSnapshot()).toMatchObject({ status: 'running', notice });
    client.dispose();
  });

  it('saves to and loads from slots', async () => {
    const client = new EmulatorClient({ store: new MemoryStore() });
    await load(client, batteryRom);
    client.pause();
    await client.saveState('2');
    expect(client.getSnapshot().slots).toMatchObject([{ slot: '2' }]);
    expect(client.getSnapshot().notice).toBe('Saved to slot 2.');
    await client.loadState('2');
    expect(client.getSnapshot().notice).toBe('Loaded slot 2.');
    client.dispose();
  });

  it('keeps battery RAM across a restart and exports it as a .sav', async () => {
    const client = new EmulatorClient({ store: new MemoryStore() });
    await load(client, batteryRom);
    client.pause();
    await step(client);
    client.reset();
    await settle();
    const save = await client.exportBattery();
    expect(save?.byteLength).toBe(0x2000);
    expect(new Uint8Array(save!)[0]).toBe(0x42);
    client.dispose();
  });

  it('imports a .sav file, replacing the stored save', async () => {
    const store = new MemoryStore();
    const client = new EmulatorClient({ store });
    await load(client, batteryRom);
    await client.importBattery(new Blob([new Uint8Array(0x2000).fill(0x17)]));
    await vi.waitFor(async () => {
      const battery = await store.getBattery(batteryKey);
      expect(new Uint8Array(battery!.data)[1]).toBe(0x17);
    });
    client.dispose();
  });
});
