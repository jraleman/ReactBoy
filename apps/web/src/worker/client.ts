import {
  Button,
  FRAME_RATE,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type Breakpoint,
  type BreakReason,
  type ButtonId,
  type CartridgeHeader,
  type DebugSnapshot,
  type Palette,
  type StepMode,
  type Watchpoint,
} from '@reactboy/core';
import { AudioOutput } from '../audio/output';
import { DEFAULT_PADMAP, type InputSource } from '../input/buttons';
import { openStore } from '../storage/idb';
import { romKey } from '../storage/rom-key';
import type { GameStore, ManualSlot, RecentGame, StateInfo, StoredSymbols } from '../storage/store';
import { createEmulatorHost } from './host';
import type { ClientMessage, DebugReport, HostMessage, Post } from './protocol';

export type EmulatorStatus = 'empty' | 'running' | 'paused' | 'error';

/** Sound waits for a user gesture ('locked'), then plays, or the browser can't play it. */
export type SoundStatus = 'locked' | 'on' | 'unavailable';

export interface AudioSettings {
  /** 0-1. */
  volume: number;
  muted: boolean;
  /** Bit n set = channel n+1 is heard. */
  channels: number;
}

export interface EmulatorState {
  status: EmulatorStatus;
  header: CartridgeHeader | null;
  /** Why the last ROM failed to load, in words a player can act on. */
  error: string | null;
  speed: number;
  fps: number;
  /** True when the core runs on the main thread because workers are unavailable. */
  inline: boolean;
  /** Bit n set = button n held by any source; drives the on-screen pressed state. */
  pressed: number;
  /** Storage id of the loaded game. */
  gameId: string | null;
  /** The loaded game's save-state slots, excluding the automatic one. */
  slots: StateInfo[];
  /** Games whose ROMs are stored on this device, most recent first. */
  recent: RecentGame[];
  /** The latest save/load event, for the player: "Saved to slot 2." Clears itself. */
  notice: string | null;
  /** False when nothing outlives the page (IndexedDB unavailable); null until known. */
  persistent: boolean | null;
  sound: SoundStatus;
}

/** The debugger's view, kept apart from {@link EmulatorState} so only it re-renders. */
export interface DebugState {
  open: boolean;
  /** The latest inspection: on every stop and step, and ~10 times a second while running. */
  snapshot: DebugSnapshot | null;
  /** The inspection before it, to highlight what changed. */
  previous: DebugSnapshot | null;
  /** Why the machine last stopped by itself; cleared when it runs again. */
  stop: BreakReason | null;
  breakpoints: Breakpoint[];
  watchpoints: Watchpoint[];
  /** The current game's symbol file, if one was loaded for it. */
  symbols: StoredSymbols | null;
  /** A step over or out is running. */
  stepping: boolean;
}

/** What the case's parts view reads, kept apart so only it re-renders. */
export interface ProbeState {
  /** The latest look at the machine, ~10 times a second while probing and running. */
  snapshot: DebugSnapshot | null;
  /** The look before it, from the same game. */
  previous: DebugSnapshot | null;
  /** Milliseconds between the two. */
  elapsed: number;
}

const NO_PROBE: ProbeState = { snapshot: null, previous: null, elapsed: 0 };

export interface EmulatorClientOptions {
  /** Where games and saves are kept; the device's IndexedDB by default. */
  store?: GameStore | Promise<GameStore>;
}

/** Frames the loop may run in one go to catch up after a hiccup, per 1x of speed. */
const MAX_CATCH_UP = 4;
/** How often a running game refreshes its resume state, as a backstop for crashes. */
const AUTOSAVE_MS = 60_000;
const NOTICE_MS = 5_000;
/** How often the debugger refreshes while the game runs. */
const INSPECT_MS = 100;

const hex4 = (v: number) => '$' + v.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (v: number) => '$' + v.toString(16).toUpperCase().padStart(2, '0');

/** A stop, in words for the status line. */
export function describeStop(stop: BreakReason): string {
  switch (stop.type) {
    case 'breakpoint':
      return `Stopped at breakpoint ${hex4(stop.pc)}.`;
    case 'watchpoint':
      return stop.access === 'write'
        ? `Stopped: ${hex4(stop.at)} wrote ${hex2(stop.value)} to ${hex4(stop.addr)}.`
        : `Stopped: ${hex4(stop.at)} read ${hex2(stop.value)} from ${hex4(stop.addr)}.`;
    case 'step':
      return `Stopped at ${hex4(stop.pc)}.`;
  }
}

/**
 * The UI's handle on the emulator. Owns the worker, paces frames from requestAnimationFrame,
 * draws them to the canvas, merges input from every source and keeps games and saves in
 * storage. React reads its state via {@link subscribe}/{@link getSnapshot}
 * (useSyncExternalStore) and never re-renders per frame.
 */
export class EmulatorClient {
  private state: EmulatorState;
  private readonly listeners = new Set<() => void>();
  private debugState: DebugState = {
    open: false,
    snapshot: null,
    previous: null,
    stop: null,
    breakpoints: [],
    watchpoints: [],
    symbols: null,
    stepping: false,
  };
  private readonly debugListeners = new Set<() => void>();
  private probeState = NO_PROBE;
  private probeTime = 0;
  private probing = false;
  private readonly probeListeners = new Set<() => void>();
  private lastInspect = 0;
  private readonly send: Post<ClientMessage>;
  private readonly worker: Worker | null;
  private readonly store: Promise<GameStore>;
  private readonly audio: AudioOutput;
  private audioSettings: AudioSettings = { volume: 1, muted: false, channels: 0x0f };
  /** What the host was last told to produce, to send changes only. */
  private hostAudio = { sampleRate: 0, channels: 0x0f };

  private canvas: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private rafId = 0;
  private lastTime = 0;
  private due = 0;
  private inFlight = false;
  private framesThisSecond = 0;
  private secondStart = 0;
  private lastAutosave = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Per-button bitmask of the sources holding it. */
  private readonly held = new Map<ButtonId, number>();
  private readonly gamepadHeld = new Set<ButtonId>();
  /** The gamepad layout as [button index, game button] pairs. */
  private padmap = padEntries(DEFAULT_PADMAP);
  /** Gamepads are being read for something else (binding a button), not the game. */
  private gamepadSuspended = false;

  private nextRequest = 1;
  private readonly requests = new Map<number, (reply: Reply) => void>();
  /** ROMs sent to the host, kept until it accepts them so they can be stored. */
  private readonly loading = new Map<string, ArrayBuffer>();
  private askedForPersistence = false;

  constructor({ store = openStore() }: EmulatorClientOptions = {}) {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./emulator.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    this.worker = worker;
    if (worker) {
      worker.onmessage = (event: MessageEvent<HostMessage>) => this.receive(event.data);
      this.send = (message, transfer = []) => worker.postMessage(message, transfer);
    } else {
      // No transfer on the main thread; deliver asynchronously to keep the same ordering.
      const host = createEmulatorHost((message) => queueMicrotask(() => this.receive(message)));
      this.send = (message) => host(message);
    }
    this.state = {
      status: 'empty',
      header: null,
      error: null,
      speed: 1,
      fps: 0,
      inline: !worker,
      pressed: 0,
      gameId: null,
      slots: [],
      recent: [],
      notice: null,
      persistent: null,
      sound: 'locked',
    };
    this.audio = new AudioOutput((ready) => {
      this.update({ sound: ready ? 'on' : 'unavailable' });
      this.syncAudio();
    });
    this.store = Promise.resolve(store);
    void this.store.then((s) => {
      this.update({ persistent: s.persistent });
      return this.refreshRecent();
    });
  }

  // --- Store ----------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EmulatorState => this.state;

  private update(patch: Partial<EmulatorState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  subscribeDebug = (listener: () => void): (() => void) => {
    this.debugListeners.add(listener);
    return () => this.debugListeners.delete(listener);
  };

  getDebugSnapshot = (): DebugState => this.debugState;

  private updateDebug(patch: Partial<DebugState>): void {
    this.debugState = { ...this.debugState, ...patch };
    this.debugListeners.forEach((listener) => listener());
  }

  subscribeProbe = (listener: () => void): (() => void) => {
    this.probeListeners.add(listener);
    return () => this.probeListeners.delete(listener);
  };

  getProbeSnapshot = (): ProbeState => this.probeState;

  private updateProbe(probeState: ProbeState): void {
    this.probeState = probeState;
    this.probeListeners.forEach((listener) => listener());
  }

  private notify(notice: string): void {
    clearTimeout(this.noticeTimer);
    this.update({ notice });
    this.noticeTimer = setTimeout(() => this.update({ notice: null }), NOTICE_MS);
  }

  // --- Commands -------------------------------------------------------------------------

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas?.getContext('2d', { alpha: false }) ?? null;
    if (this.canvas && this.image) this.canvas.putImageData(this.image, 0, 0);
  }

  async loadRom(file: Blob): Promise<void> {
    const rom = await file.arrayBuffer();
    await this.start(rom, romKey(rom));
  }

  /** Starts a game stored on this device. */
  async loadRecent(id: string): Promise<void> {
    const rom = await this.useStore((store) => store.getRom(id));
    if (rom) return this.start(rom, id);
    this.update({ error: 'That game is no longer stored on this device.' });
    await this.refreshRecent();
  }

  /** Forgets a stored ROM; its saves stay for when the file is loaded again. */
  async removeRecent(id: string): Promise<void> {
    await this.useStore((store) => store.removeRom(id));
    await this.refreshRecent();
  }

  play(): void {
    if (this.state.status !== 'paused') return;
    if (this.debugState.stop) this.updateDebug({ stop: null });
    this.update({ status: 'running' });
    this.startLoop();
    this.syncAudio();
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.halt();
    // The last inspection may be up to 100 ms old.
    if (this.debugState.open) this.redraw();
  }

  /** Pauses where the game is, e.g. at a breakpoint. */
  private halt(): void {
    this.update({ status: 'paused', fps: 0 });
    this.stopLoop();
    this.syncAudio();
    this.releaseAll();
    if (this.debugState.stepping) {
      this.send({ type: 'cancel-step' });
      this.updateDebug({ stepping: false });
    }
    void this.persist();
  }

  reset(): void {
    if (!this.state.header) return;
    this.send({ type: 'reset' });
  }

  /** Advances exactly one frame while paused. */
  stepFrame(): void {
    if (this.state.status !== 'paused' || this.inFlight) return;
    this.inFlight = true;
    this.send({ type: 'run', frames: 1, inspect: this.inspecting });
  }

  // --- Debugger -------------------------------------------------------------------------

  /** Opening the debugger arms its breakpoints; closing it returns to full speed. */
  setDebuggerOpen(open: boolean): void {
    if (open === this.debugState.open) return;
    this.updateDebug({
      open,
      stop: null,
      stepping: false,
      ...(!open && { snapshot: null, previous: null }),
    });
    this.syncDebugger();
    this.redraw();
  }

  /**
   * Keeps {@link getProbeSnapshot} fresh while someone looks at the case's parts. Unlike the
   * debugger it arms nothing, so the game runs exactly as it would otherwise.
   */
  setProbing(probing: boolean): void {
    if (probing === this.probing) return;
    this.probing = probing;
    if (probing) this.redraw();
    else this.updateProbe(NO_PROBE);
  }

  /** Frames are asked to come with a snapshot. */
  private get inspecting(): boolean {
    return this.debugState.open || this.probing;
  }

  setBreakpoints(breakpoints: Breakpoint[]): void {
    this.updateDebug({ breakpoints });
    this.syncDebugger();
  }

  setWatchpoints(watchpoints: Watchpoint[]): void {
    this.updateDebug({ watchpoints });
    this.syncDebugger();
  }

  /** Edits memory while paused; see GameBoy.poke for what can be changed. */
  poke(addr: number, value: number): void {
    if (!this.debugState.open || this.state.status !== 'paused' || this.inFlight) return;
    this.inFlight = true;
    this.send({ type: 'poke', addr, value });
  }

  /** Keeps a symbol file for the current game (null forgets it). */
  async setSymbols(symbols: StoredSymbols | null): Promise<void> {
    const id = this.state.gameId;
    if (!id) return;
    this.updateDebug({ symbols });
    await this.useStore((store) => store.putSymbols(id, symbols));
  }

  /** Steps the paused machine. Over and out may run on until the routine returns. */
  debugStep(mode: StepMode): void {
    if (!this.debugState.open || this.state.status !== 'paused' || this.inFlight) return;
    this.inFlight = true;
    this.updateDebug({ stop: null });
    this.send({ type: 'step', mode });
  }

  private syncDebugger(): void {
    const { open, breakpoints, watchpoints } = this.debugState;
    this.send({ type: 'debug', enabled: open, breakpoints, watchpoints });
  }

  setSpeed(speed: number): void {
    this.update({ speed });
    this.syncAudio();
  }

  /** Lets sound start; browsers only allow that from a user gesture such as a key press. */
  unlockAudio(): void {
    this.audio.unlock();
  }

  setAudio(settings: AudioSettings): void {
    this.audioSettings = settings;
    this.audio.setVolume(settings.muted ? 0 : settings.volume);
    this.syncAudio();
  }

  setPalette(palette: Palette): void {
    this.send({ type: 'palette', palette });
    this.redraw();
  }

  setButton(source: InputSource, button: ButtonId, pressed: boolean): void {
    const bit = SOURCE_BITS[source];
    const before = this.held.get(button) ?? 0;
    const after = pressed ? before | bit : before & ~bit;
    this.held.set(button, after);
    if ((before === 0) === (after === 0)) return;
    this.send({ type: 'button', button, pressed: after !== 0 });
    this.update({
      pressed: after ? this.state.pressed | (1 << button) : this.state.pressed & ~(1 << button),
    });
  }

  dispose(): void {
    this.stopLoop();
    this.audio.close();
    clearTimeout(this.noticeTimer);
    this.worker?.terminate();
    this.listeners.clear();
  }

  // --- Saves ----------------------------------------------------------------------------

  /**
   * Stores the current game's battery RAM and a state to resume from next time. Runs on
   * pause, when the page is hidden, before switching games and once a minute in play.
   */
  async persist(): Promise<void> {
    const id = this.state.gameId;
    if (!id) return;
    try {
      // The host reports unsaved battery RAM before answering, so the battery record is
      // always stamped no later than this state.
      const data = await this.request((rid) => ({ type: 'snapshot', id: rid }));
      if (!data) return;
      const store = await this.store;
      await store.putState(id, { slot: 'auto', data, created: Date.now(), thumbnail: null });
    } catch (error) {
      this.storageFailed(error);
    }
  }

  async saveState(slot: ManualSlot): Promise<void> {
    const id = this.state.gameId;
    if (!id) return;
    try {
      const data = await this.request((rid) => ({ type: 'snapshot', id: rid }));
      if (!data) return;
      const info: StateInfo = { slot, created: Date.now(), thumbnail: this.thumbnail() };
      const store = await this.store;
      await store.putState(id, { ...info, data });
      if (this.state.gameId !== id) return;
      this.update({ slots: [...this.state.slots.filter((s) => s.slot !== slot), info] });
      this.notify(`Saved to slot ${slot}.`);
    } catch (error) {
      this.storageFailed(error);
    }
  }

  async loadState(slot: ManualSlot): Promise<void> {
    const id = this.state.gameId;
    if (!id) return;
    const saved = await this.useStore((store) => store.getState(id, slot));
    if (this.state.gameId !== id) return;
    if (!saved) return this.notify(`Slot ${slot} is empty.`);
    try {
      await this.request((rid) => ({ type: 'restore', id: rid, state: saved.data }));
      this.notify(`Loaded slot ${slot}.`);
      this.redraw();
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error));
    }
  }

  /** The battery RAM as a .sav file, or null if the game has no battery. */
  async exportBattery(): Promise<ArrayBuffer | null> {
    if (!this.state.header?.hasBattery) return null;
    return this.request((rid) => ({ type: 'export-battery', id: rid }));
  }

  /** Replaces the battery save with a .sav file and restarts the game. */
  async importBattery(file: Blob): Promise<void> {
    if (!this.state.header?.hasBattery) return;
    this.send({ type: 'reset', battery: await file.arrayBuffer() });
    this.notify('Save imported. The game restarted.');
  }

  private async start(rom: ArrayBuffer, key: string): Promise<void> {
    await this.persist();
    const [battery, auto] = await this.useStore((store) =>
      Promise.all([store.getBattery(key), store.getState(key, 'auto')]),
    ).then((found) => found ?? [null, null]);
    // A resume state older than the battery save would roll back progress saved since.
    const resume = auto && (!battery || auto.created >= battery.updated) ? auto.data : null;
    this.loading.set(key, rom);
    this.send({ type: 'load', rom, key, battery: battery?.data ?? null, state: resume });
  }

  private async onLoaded(key: string, header: CartridgeHeader): Promise<void> {
    const rom = this.loading.get(key);
    this.loading.delete(key);
    await this.useStore(async (store) => {
      // Absent after a restart, which doesn't count as playing it again.
      if (rom) {
        const game = { id: key, title: header.title, size: rom.byteLength, lastPlayed: Date.now() };
        await store.putRom(game, rom);
        this.askForPersistence();
      }
      const [slots, symbols] = await Promise.all([store.listStates(key), store.getSymbols(key)]);
      if (this.state.gameId === key) {
        this.update({ slots: slots.filter((s) => s.slot !== 'auto') });
        this.updateDebug({ symbols });
      }
    });
    await this.refreshRecent();
  }

  private async refreshRecent(): Promise<void> {
    const recent = await this.useStore((store) => store.listRecent());
    if (recent) this.update({ recent });
  }

  /** Runs a storage operation, reporting failures instead of throwing. */
  private async useStore<T>(operation: (store: GameStore) => Promise<T>): Promise<T | null> {
    try {
      return await operation(await this.store);
    } catch (error) {
      this.storageFailed(error);
      return null;
    }
  }

  private storageFailed(error: unknown): void {
    const quota = error instanceof DOMException && error.name === 'QuotaExceededError';
    this.notify(
      quota
        ? 'Couldn’t save: this device is out of storage space for ReactBoy.'
        : 'Couldn’t save on this device.',
    );
  }

  /** Asks the browser not to evict saves under storage pressure (notably iOS Safari). */
  private askForPersistence(): void {
    if (this.askedForPersistence) return;
    this.askedForPersistence = true;
    void navigator.storage?.persist?.().catch(() => false);
  }

  /** The last frame drawn, as a PNG data URL for save-slot previews. */
  private thumbnail(): string | null {
    if (!this.image) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SCREEN_WIDTH;
      canvas.height = SCREEN_HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.putImageData(this.image, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  private request(make: (id: number) => ClientMessage): Promise<ArrayBuffer | null> {
    const id = this.nextRequest++;
    return new Promise((resolve, reject) => {
      this.requests.set(id, ({ data, error }) =>
        error ? reject(new Error(error)) : resolve(data),
      );
      this.send(make(id));
    });
  }

  /**
   * Has the host produce sound only while it can be heard: running at 1x (other speeds
   * would starve or flood the output) and not muted.
   */
  private syncAudio(): void {
    const { volume, muted, channels } = this.audioSettings;
    const audible = this.state.status === 'running' && this.state.speed === 1 && !muted;
    const sampleRate = audible && volume > 0 ? this.audio.sampleRate : 0;
    if (sampleRate === this.hostAudio.sampleRate && channels === this.hostAudio.channels) return;
    this.hostAudio = { sampleRate, channels };
    this.send({ type: 'audio', sampleRate, channels });
  }

  /** Shows the current frame again (e.g. in new colors) while paused. */
  private redraw(): void {
    if (this.state.status !== 'paused') return;
    this.inFlight = true;
    this.send({ type: 'run', frames: 0, inspect: this.inspecting });
  }

  // --- Frame loop -----------------------------------------------------------------------

  private startLoop(): void {
    if (this.rafId) return;
    this.lastTime = performance.now();
    this.secondStart = this.lastTime;
    this.lastAutosave = this.lastTime;
    this.framesThisSecond = 0;
    this.due = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    this.pollGamepads();

    // Run at the DMG's ~59.73 Hz regardless of display refresh rate.
    const speed = this.state.speed;
    const limit = Math.ceil(MAX_CATCH_UP * speed);
    this.due = Math.min(this.due + ((now - this.lastTime) / 1000) * FRAME_RATE * speed, limit);
    this.lastTime = now;
    if (!this.inFlight && this.due >= 1) {
      const frames = Math.floor(this.due);
      this.due -= frames;
      this.inFlight = true;
      const inspect = this.inspecting && now - this.lastInspect >= INSPECT_MS;
      if (inspect) this.lastInspect = now;
      this.send({ type: 'run', frames, inspect });
      this.framesThisSecond += frames;
    }

    if (now - this.secondStart >= 1000) {
      const fps = Math.round((this.framesThisSecond * 1000) / (now - this.secondStart));
      this.secondStart = now;
      this.framesThisSecond = 0;
      if (fps !== this.state.fps) this.update({ fps });
    }

    if (now - this.lastAutosave >= AUTOSAVE_MS) {
      this.lastAutosave = now;
      void this.persist();
    }
  };

  private receive(message: HostMessage): void {
    switch (message.type) {
      case 'loaded': {
        // A reset reloads the same game; its symbols stay.
        const sameGame = message.key === this.state.gameId;
        this.update({
          status: 'running',
          header: message.header,
          error: null,
          gameId: message.key,
          slots: [],
        });
        if (message.resumed) this.notify('Resumed where you left off.');
        this.updateDebug({
          snapshot: null,
          previous: null,
          stop: null,
          stepping: false,
          ...(!sameGame && { symbols: null }),
        });
        // Cycle counts restart with the game; don't compare across the reload.
        this.updateProbe(NO_PROBE);
        this.audio.clear();
        this.startLoop();
        this.syncAudio();
        void this.onLoaded(message.key, message.header);
        break;
      }
      case 'error':
        this.loading.delete(message.key);
        // A bad file while a game is loaded leaves that game running and just reports.
        if (!this.state.header) this.stopLoop();
        this.update({
          status: this.state.header ? this.state.status : 'error',
          error: message.message,
        });
        break;
      case 'frame':
        this.inFlight = false;
        if (message.debug) this.inspected(message.debug);
        if (message.audio) this.audio.push(new Float32Array(message.audio));
        if (!message.pixels) break;
        if (this.canvas) {
          this.image ??= new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
          this.image.data.set(new Uint8ClampedArray(message.pixels));
          this.canvas.putImageData(this.image, 0, 0);
        }
        this.send({ type: 'recycle', pixels: message.pixels }, [message.pixels]);
        break;
      case 'battery': {
        const battery = { data: message.data, updated: Date.now() };
        void this.useStore((store) => store.putBattery(message.key, battery));
        break;
      }
      case 'reply':
        this.requests.get(message.id)?.(message);
        this.requests.delete(message.id);
        break;
    }
  }

  private inspected({ snapshot, stop, stepping }: DebugReport): void {
    if (this.probing) this.probed(snapshot);
    if (!this.debugState.open) return;
    this.updateDebug({ snapshot, previous: this.debugState.snapshot, stepping, stop });
    if (stop) {
      if (this.state.status === 'running') this.halt();
      this.notify(describeStop(stop));
    } else if (stepping) {
      this.play();
    }
  }

  private probed(snapshot: DebugSnapshot): void {
    const now = performance.now();
    const previous = this.probeState.snapshot;
    this.updateProbe({ snapshot, previous, elapsed: previous ? now - this.probeTime : 0 });
    this.probeTime = now;
  }

  // --- Input ----------------------------------------------------------------------------

  /** Game buttons by gamepad button index (standard mapping). */
  setGamepadMap(padmap: Record<string, ButtonId>): void {
    this.padmap = padEntries(padmap);
  }

  /** While suspended, gamepad presses don't reach the game (e.g. while binding buttons). */
  suspendGamepad(suspended: boolean): void {
    this.gamepadSuspended = suspended;
  }

  private pollGamepads(): void {
    const pads =
      typeof navigator.getGamepads === 'function' && !this.gamepadSuspended
        ? navigator.getGamepads()
        : [];
    const now = new Set<ButtonId>();
    for (const pad of pads) {
      if (!pad) continue;
      for (const [index, button] of this.padmap) {
        if (pad.buttons[index]?.pressed) now.add(button);
      }
      const [x = 0, y = 0] = pad.axes;
      if (x < -0.5) now.add(GAMEPAD_AXES.left);
      if (x > 0.5) now.add(GAMEPAD_AXES.right);
      if (y < -0.5) now.add(GAMEPAD_AXES.up);
      if (y > 0.5) now.add(GAMEPAD_AXES.down);
    }
    for (const button of this.gamepadHeld) {
      if (!now.has(button)) this.setButton('gamepad', button, false);
    }
    for (const button of now) {
      if (!this.gamepadHeld.has(button)) this.setButton('gamepad', button, true);
    }
    this.gamepadHeld.clear();
    now.forEach((button) => this.gamepadHeld.add(button));
  }

  /** Lets go of everything, e.g. when pausing or losing focus mid-press. */
  releaseAll(): void {
    for (const [button, sources] of this.held) {
      if (sources !== 0) this.send({ type: 'button', button, pressed: false });
    }
    this.held.clear();
    this.gamepadHeld.clear();
    if (this.state.pressed) this.update({ pressed: 0 });
  }
}

type Reply = Extract<HostMessage, { type: 'reply' }>;

const SOURCE_BITS: Record<InputSource, number> = { keyboard: 1, touch: 2, gamepad: 4 };

const padEntries = (padmap: Record<string, ButtonId>): [number, ButtonId][] =>
  Object.entries(padmap).map(([index, button]) => [Number(index), button]);

const GAMEPAD_AXES = {
  up: Button.Up,
  down: Button.Down,
  left: Button.Left,
  right: Button.Right,
} as const;
