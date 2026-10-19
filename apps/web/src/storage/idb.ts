import {
  byLastPlayed,
  MAX_RECENT,
  MemoryStore,
  type GameStore,
  type RecentGame,
  type SlotId,
  type StateInfo,
  type StoredBattery,
  type StoredState,
  type StoredSymbols,
} from './store';

const DB_NAME = 'reactboy';
/** 1: games, batteries and states. 2: debugger symbols. */
const DB_VERSION = 2;

/** Object stores. ROM bytes live apart from their metadata so listing games stays cheap. */
const LIBRARY = 'library';
const ROMS = 'roms';
const BATTERIES = 'batteries';
const STATES = 'states';
const SYMBOLS = 'symbols';

interface StateRecord extends StoredState {
  id: string;
}

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const completion = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted.'));
  });

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(LIBRARY, { keyPath: 'id' });
        db.createObjectStore(ROMS);
        db.createObjectStore(BATTERIES);
        db.createObjectStore(STATES, { keyPath: ['id', 'slot'] });
      }
      if (event.oldVersion < 2) db.createObjectStore(SYMBOLS);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let a newer version of the app in another tab upgrade the schema.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

export class IdbStore implements GameStore {
  readonly persistent = true;

  constructor(private readonly db: IDBDatabase) {}

  async listRecent(): Promise<RecentGame[]> {
    const games = await result(this.store(LIBRARY).getAll() as IDBRequest<RecentGame[]>);
    return games.sort(byLastPlayed);
  }

  async getRom(id: string): Promise<ArrayBuffer | null> {
    return (await result(this.store(ROMS).get(id) as IDBRequest<ArrayBuffer | undefined>)) ?? null;
  }

  async putRom(game: RecentGame, data: ArrayBuffer): Promise<void> {
    const tx = this.db.transaction([LIBRARY, ROMS], 'readwrite');
    const library = tx.objectStore(LIBRARY);
    const roms = tx.objectStore(ROMS);
    library.put(game);
    // Relaunching a stored game only refreshes its metadata; the bytes are already there.
    if ((await result(roms.count(game.id))) === 0) roms.put(data, game.id);
    const games = (await result(library.getAll() as IDBRequest<RecentGame[]>)).sort(byLastPlayed);
    for (const stale of games.slice(MAX_RECENT)) {
      library.delete(stale.id);
      roms.delete(stale.id);
    }
    await completion(tx);
  }

  async removeRom(id: string): Promise<void> {
    const tx = this.db.transaction([LIBRARY, ROMS], 'readwrite');
    tx.objectStore(LIBRARY).delete(id);
    tx.objectStore(ROMS).delete(id);
    await completion(tx);
  }

  async getBattery(id: string): Promise<StoredBattery | null> {
    const request = this.store(BATTERIES).get(id) as IDBRequest<StoredBattery | undefined>;
    return (await result(request)) ?? null;
  }

  async putBattery(id: string, battery: StoredBattery): Promise<void> {
    const tx = this.db.transaction(BATTERIES, 'readwrite');
    tx.objectStore(BATTERIES).put(battery, id);
    await completion(tx);
  }

  async getState(id: string, slot: SlotId): Promise<StoredState | null> {
    const request = this.store(STATES).get([id, slot]) as IDBRequest<StateRecord | undefined>;
    const record = await result(request);
    if (!record) return null;
    const { slot: s, created, thumbnail, data } = record;
    return { slot: s, created, thumbnail, data };
  }

  async putState(id: string, state: StoredState): Promise<void> {
    const tx = this.db.transaction(STATES, 'readwrite');
    tx.objectStore(STATES).put({ ...state, id: id } satisfies StateRecord);
    await completion(tx);
  }

  async listStates(id: string): Promise<StateInfo[]> {
    const range = IDBKeyRange.bound([id, ''], [id, '￿']);
    const records = await result(this.store(STATES).getAll(range) as IDBRequest<StateRecord[]>);
    return records.map(({ slot, created, thumbnail }) => ({ slot, created, thumbnail }));
  }

  async getSymbols(id: string): Promise<StoredSymbols | null> {
    const request = this.store(SYMBOLS).get(id) as IDBRequest<StoredSymbols | undefined>;
    return (await result(request)) ?? null;
  }

  async putSymbols(id: string, symbols: StoredSymbols | null): Promise<void> {
    const tx = this.db.transaction(SYMBOLS, 'readwrite');
    if (symbols) tx.objectStore(SYMBOLS).put(symbols, id);
    else tx.objectStore(SYMBOLS).delete(id);
    await completion(tx);
  }

  private store(name: string): IDBObjectStore {
    return this.db.transaction(name, 'readonly').objectStore(name);
  }
}

/**
 * The device's store, or an in-memory one when IndexedDB is missing or refuses to open
 * (some private-browsing modes), so the emulator still works without saves surviving.
 */
export async function openStore(factory?: IDBFactory): Promise<GameStore> {
  try {
    const source = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
    if (!source) return new MemoryStore();
    return new IdbStore(await openDatabase(source));
  } catch {
    return new MemoryStore();
  }
}
