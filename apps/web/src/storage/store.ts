/** Save-state slots per game: three the player manages, plus one written automatically. */
export type SlotId = '1' | '2' | '3' | 'auto';
export const MANUAL_SLOTS = ['1', '2', '3'] as const satisfies readonly SlotId[];
export type ManualSlot = (typeof MANUAL_SLOTS)[number];

/** ROMs kept for one-click relaunch; older ones are dropped, their saves are not. */
export const MAX_RECENT = 6;

export interface RecentGame {
  /** {@link romKey} of the ROM. */
  id: string;
  title: string;
  size: number;
  lastPlayed: number;
}

export interface StoredBattery {
  data: ArrayBuffer;
  updated: number;
}

export interface StateInfo {
  slot: SlotId;
  created: number;
  /** PNG data URL of the screen when the state was made. */
  thumbnail: string | null;
}

export interface StoredState extends StateInfo {
  data: ArrayBuffer;
}

/** A debugger symbol file (RGBDS .sym) kept for a game. */
export interface StoredSymbols {
  name: string;
  text: string;
}

/** Everything ReactBoy keeps on the device, keyed by game. */
export interface GameStore {
  /** False when saves only last until the page is closed. */
  readonly persistent: boolean;
  /** Most recently played first. */
  listRecent(): Promise<RecentGame[]>;
  getRom(id: string): Promise<ArrayBuffer | null>;
  /** Adds or refreshes a game, keeping the {@link MAX_RECENT} most recently played ROMs. */
  putRom(game: RecentGame, data: ArrayBuffer): Promise<void>;
  /** Forgets a ROM. Its saves stay, so loading the same file again brings them back. */
  removeRom(id: string): Promise<void>;
  getBattery(id: string): Promise<StoredBattery | null>;
  putBattery(id: string, battery: StoredBattery): Promise<void>;
  getState(id: string, slot: SlotId): Promise<StoredState | null>;
  putState(id: string, state: StoredState): Promise<void>;
  /** States saved for a game, without their data. */
  listStates(id: string): Promise<StateInfo[]>;
  getSymbols(id: string): Promise<StoredSymbols | null>;
  /** Null forgets them. */
  putSymbols(id: string, symbols: StoredSymbols | null): Promise<void>;
}

export const byLastPlayed = (a: RecentGame, b: RecentGame) => b.lastPlayed - a.lastPlayed;

/** Keeps everything in memory: for tests, and browsers where IndexedDB is unavailable. */
export class MemoryStore implements GameStore {
  readonly persistent = false;
  private readonly library = new Map<string, RecentGame>();
  private readonly roms = new Map<string, ArrayBuffer>();
  private readonly batteries = new Map<string, StoredBattery>();
  private readonly states = new Map<string, StoredState>();
  private readonly symbols = new Map<string, StoredSymbols>();

  async listRecent(): Promise<RecentGame[]> {
    return [...this.library.values()].sort(byLastPlayed);
  }

  async getRom(id: string): Promise<ArrayBuffer | null> {
    return this.roms.get(id)?.slice(0) ?? null;
  }

  async putRom(game: RecentGame, data: ArrayBuffer): Promise<void> {
    this.library.set(game.id, { ...game });
    if (!this.roms.has(game.id)) this.roms.set(game.id, data.slice(0));
    for (const stale of (await this.listRecent()).slice(MAX_RECENT)) await this.removeRom(stale.id);
  }

  async removeRom(id: string): Promise<void> {
    this.library.delete(id);
    this.roms.delete(id);
  }

  async getBattery(id: string): Promise<StoredBattery | null> {
    const battery = this.batteries.get(id);
    return battery ? { ...battery, data: battery.data.slice(0) } : null;
  }

  async putBattery(id: string, battery: StoredBattery): Promise<void> {
    this.batteries.set(id, { ...battery, data: battery.data.slice(0) });
  }

  async getState(id: string, slot: SlotId): Promise<StoredState | null> {
    const state = this.states.get(`${id}/${slot}`);
    return state ? { ...state, data: state.data.slice(0) } : null;
  }

  async putState(id: string, state: StoredState): Promise<void> {
    this.states.set(`${id}/${state.slot}`, { ...state, data: state.data.slice(0) });
  }

  async listStates(id: string): Promise<StateInfo[]> {
    return [...this.states.entries()]
      .filter(([key]) => key.startsWith(`${id}/`))
      .map(([, { slot, created, thumbnail }]) => ({ slot, created, thumbnail }));
  }

  async getSymbols(id: string): Promise<StoredSymbols | null> {
    const symbols = this.symbols.get(id);
    return symbols ? { ...symbols } : null;
  }

  async putSymbols(id: string, symbols: StoredSymbols | null): Promise<void> {
    if (symbols) this.symbols.set(id, { ...symbols });
    else this.symbols.delete(id);
  }
}
