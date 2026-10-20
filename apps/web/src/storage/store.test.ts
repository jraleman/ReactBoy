import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IdbStore, openDatabase, openStore } from './idb';
import { romKey } from './rom-key';
import { MAX_RECENT, MemoryStore, type GameStore } from './store';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const game = (id: string, lastPlayed: number) => ({
  id,
  title: id.toUpperCase(),
  size: 3,
  lastPlayed,
});

const stores: [string, () => Promise<GameStore>][] = [
  ['MemoryStore', async () => new MemoryStore()],
  ['IdbStore', async () => new IdbStore(await openDatabase(new IDBFactory()))],
];

describe.each(stores)('%s', (_, create) => {
  it('stores ROMs and lists them most recent first', async () => {
    const store = await create();
    await store.putRom(game('a', 1), bytes(1, 2, 3));
    await store.putRom(game('b', 2), bytes(4, 5, 6));
    expect((await store.listRecent()).map((g) => g.id)).toEqual(['b', 'a']);
    expect(new Uint8Array((await store.getRom('a'))!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.getRom('missing')).toBeNull();
  });

  it('refreshes metadata when a stored game is played again', async () => {
    const store = await create();
    await store.putRom(game('a', 1), bytes(1));
    await store.putRom(game('b', 2), bytes(2));
    await store.putRom(game('a', 3), bytes(1));
    expect((await store.listRecent()).map((g) => g.id)).toEqual(['a', 'b']);
  });

  it(`keeps only the ${MAX_RECENT} most recent ROMs but never their saves`, async () => {
    const store = await create();
    await store.putBattery('g0', { data: bytes(9), updated: 1 });
    for (let i = 0; i <= MAX_RECENT; i++) await store.putRom(game(`g${i}`, i), bytes(i));
    const recent = await store.listRecent();
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent.map((g) => g.id)).not.toContain('g0');
    expect(await store.getRom('g0')).toBeNull();
    expect(await store.getBattery('g0')).toMatchObject({ updated: 1 });
  });

  it('removes a ROM on request, keeping its saves', async () => {
    const store = await create();
    await store.putRom(game('a', 1), bytes(1));
    await store.putState('a', { slot: '1', data: bytes(7), created: 5, thumbnail: null });
    await store.removeRom('a');
    expect(await store.listRecent()).toEqual([]);
    expect(await store.getState('a', '1')).not.toBeNull();
  });

  it('keeps states per game and slot', async () => {
    const store = await create();
    await store.putState('a', { slot: '1', data: bytes(1), created: 10, thumbnail: 'data:x' });
    await store.putState('a', { slot: 'auto', data: bytes(2), created: 11, thumbnail: null });
    await store.putState('ab', { slot: '1', data: bytes(3), created: 12, thumbnail: null });
    await store.putState('a', { slot: '1', data: bytes(4), created: 13, thumbnail: null });

    const states = await store.listStates('a');
    expect(states.sort((x, y) => x.created - y.created)).toEqual([
      { slot: 'auto', created: 11, thumbnail: null },
      { slot: '1', created: 13, thumbnail: null },
    ]);
    const slot1 = await store.getState('a', '1');
    expect(new Uint8Array(slot1!.data)).toEqual(new Uint8Array([4]));
    expect(await store.getState('a', '2')).toBeNull();
  });

  it('keeps one symbol file per game until it is cleared', async () => {
    const store = await create();
    expect(await store.getSymbols('a')).toBeNull();
    await store.putSymbols('a', { name: 'a.sym', text: '00:0150 Main' });
    await store.putSymbols('b', { name: 'b.sym', text: '00:0150 Start' });
    expect(await store.getSymbols('a')).toEqual({ name: 'a.sym', text: '00:0150 Main' });
    await store.putSymbols('a', null);
    expect(await store.getSymbols('a')).toBeNull();
    expect((await store.getSymbols('b'))?.name).toBe('b.sym');
  });
});

describe('openStore', () => {
  it('uses IndexedDB when it opens', async () => {
    expect((await openStore(new IDBFactory())).persistent).toBe(true);
  });

  it('upgrades a database from before symbols were stored, keeping its saves', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('reactboy', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('library', { keyPath: 'id' });
        db.createObjectStore('roms');
        db.createObjectStore('batteries').put({ data: bytes(7), updated: 1 }, 'a');
        db.createObjectStore('states', { keyPath: ['id', 'slot'] });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const store = new IdbStore(await openDatabase(factory));
    expect((await store.getBattery('a'))?.updated).toBe(1);
    await store.putSymbols('a', { name: 'a.sym', text: '00:0150 Main' });
    expect((await store.getSymbols('a'))?.name).toBe('a.sym');
  });

  it('falls back to memory when IndexedDB refuses to open', async () => {
    const broken = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    expect((await openStore(broken)).persistent).toBe(false);
  });
});

describe('romKey', () => {
  it('depends on every byte and the size, not on anything else', () => {
    const rom = new Uint8Array(0x8000).map((_, i) => i * 7);
    const same = romKey(rom.slice().buffer);
    expect(romKey(rom.buffer)).toBe(same);
    const changed = rom.slice();
    changed[0x7fff]! ^= 1;
    expect(romKey(changed.buffer)).not.toBe(same);
    expect(romKey(rom.slice(0, 0x7fff).buffer)).not.toBe(same);
    expect(romKey(bytes(1, 2, 3))).not.toBe(romKey(bytes(1, 2, 4)));
  });
});
