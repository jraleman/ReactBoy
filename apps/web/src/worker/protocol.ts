import type { ButtonId, CartridgeHeader, Palette } from '@reactboy/core';

/** Messages from the UI thread to the emulator host. */
export type ClientMessage =
  | { type: 'load'; rom: ArrayBuffer }
  | { type: 'run'; frames: number }
  | { type: 'reset' }
  | { type: 'button'; button: ButtonId; pressed: boolean }
  | { type: 'palette'; palette: Palette }
  /** Returns a framebuffer to the host's pool once it has been drawn. */
  | { type: 'recycle'; pixels: ArrayBuffer };

/** Messages from the emulator host back to the UI thread. */
export type HostMessage =
  | { type: 'loaded'; header: CartridgeHeader }
  /** `pixels` is null when no game is loaded. */
  | { type: 'frame'; pixels: ArrayBuffer | null; frameCount: number }
  | { type: 'error'; message: string };

export type Post<T> = (message: T, transfer?: Transferable[]) => void;
