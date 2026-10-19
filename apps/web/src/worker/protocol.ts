import type {
  Breakpoint,
  BreakReason,
  ButtonId,
  CartridgeHeader,
  DebugSnapshot,
  Palette,
  StepMode,
  Watchpoint,
} from '@reactboy/core';

/** Messages from the UI thread to the emulator host. */
export type ClientMessage =
  /**
   * Starts a game with its battery save and, to resume, a save state. `key` identifies the
   * game in the battery reports that follow.
   */
  | {
      type: 'load';
      rom: ArrayBuffer;
      key: string;
      battery: ArrayBuffer | null;
      state: ArrayBuffer | null;
    }
  /**
   * Runs `frames` frames (0 just redraws) and answers with a frame. `inspect` asks for a
   * snapshot with it; with the debugger on, a breakpoint may also end the run early.
   */
  | { type: 'run'; frames: number; inspect?: boolean }
  /** Power-cycles the game, keeping its battery RAM unless `battery` replaces it. */
  | { type: 'reset'; battery?: ArrayBuffer }
  | { type: 'button'; button: ButtonId; pressed: boolean }
  | { type: 'palette'; palette: Palette }
  /** Produce sound at `sampleRate` Hz (0 = none) from the channels set in `channels`. */
  | { type: 'audio'; sampleRate: number; channels: number }
  /** Returns a framebuffer to the host's pool once it has been drawn. */
  | { type: 'recycle'; pixels: ArrayBuffer }
  /** Asks for a save state, after reporting any unsaved battery RAM. */
  | { type: 'snapshot'; id: number }
  | { type: 'restore'; id: number; state: ArrayBuffer }
  /** Asks for the battery RAM as a .sav file. */
  | { type: 'export-battery'; id: number }
  /** Turns the debugger on or off and replaces its breakpoints and watchpoints. */
  | { type: 'debug'; enabled: boolean; breakpoints: Breakpoint[]; watchpoints: Watchpoint[] }
  /** Edits memory (debugger on, paused; see GameBoy.poke) and answers with an inspected frame. */
  | { type: 'poke'; addr: number; value: number }
  /** Steps the paused machine (debugger on) and answers with an inspected frame. */
  | { type: 'step'; mode: StepMode }
  /** Abandons a step over or step out that is still running. */
  | { type: 'cancel-step' };

/** What the debugger reports with a frame. */
export interface DebugReport {
  snapshot: DebugSnapshot;
  /** Why the run stopped early, or null if it didn't. */
  stop: BreakReason | null;
  /** A step over or out is still running: keep running frames until it stops. */
  stepping: boolean;
}

/** Messages from the emulator host back to the UI thread. */
export type HostMessage =
  /** `resumed` is true when the game continues from the state it was loaded with. */
  | { type: 'loaded'; key: string; header: CartridgeHeader; resumed: boolean }
  /**
   * `pixels` is null when no game is loaded; `audio` holds the frames' interleaved stereo
   * samples, or null without sound; `debug` is set when inspected or stopped.
   */
  | {
      type: 'frame';
      pixels: ArrayBuffer | null;
      audio: ArrayBuffer | null;
      frameCount: number;
      debug: DebugReport | null;
    }
  /** A game failed to load; whatever was running keeps running. */
  | { type: 'error'; key: string; message: string }
  /** Battery RAM of game `key` changed; store it. */
  | { type: 'battery'; key: string; data: ArrayBuffer }
  /** Answers the request with the same `id`. */
  | { type: 'reply'; id: number; data: ArrayBuffer | null; error: string | null };

export type Post<T> = (message: T, transfer?: Transferable[]) => void;
