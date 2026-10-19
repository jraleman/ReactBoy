import {
  Button,
  FRAME_RATE,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type ButtonId,
  type CartridgeHeader,
  type Palette,
} from '@reactboy/core';
import { GAMEPAD_BUTTONS, type InputSource } from '../input/buttons';
import { createEmulatorHost } from './host';
import type { ClientMessage, HostMessage, Post } from './protocol';

export type EmulatorStatus = 'empty' | 'running' | 'paused' | 'error';

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
}

/** Frames the loop may run in one go to catch up after a hiccup, per 1x of speed. */
const MAX_CATCH_UP = 4;

/**
 * The UI's handle on the emulator. Owns the worker, paces frames from requestAnimationFrame,
 * draws them to the canvas and merges input from every source. React reads its state via
 * {@link subscribe}/{@link getSnapshot} (useSyncExternalStore) and never re-renders per frame.
 */
export class EmulatorClient {
  private state: EmulatorState;
  private readonly listeners = new Set<() => void>();
  private readonly send: Post<ClientMessage>;
  private readonly worker: Worker | null;

  private canvas: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private rafId = 0;
  private lastTime = 0;
  private due = 0;
  private inFlight = false;
  private framesThisSecond = 0;
  private secondStart = 0;

  /** Per-button bitmask of the sources holding it. */
  private readonly held = new Map<ButtonId, number>();
  private readonly gamepadHeld = new Set<ButtonId>();

  constructor() {
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
    };
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

  // --- Commands -------------------------------------------------------------------------

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas?.getContext('2d', { alpha: false }) ?? null;
    if (this.canvas && this.image) this.canvas.putImageData(this.image, 0, 0);
  }

  async loadRom(file: Blob): Promise<void> {
    const rom = await file.arrayBuffer();
    this.send({ type: 'load', rom }, [rom]);
  }

  play(): void {
    if (this.state.status !== 'paused') return;
    this.update({ status: 'running' });
    this.startLoop();
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.update({ status: 'paused', fps: 0 });
    this.stopLoop();
    this.releaseAll();
  }

  reset(): void {
    if (!this.state.header) return;
    this.send({ type: 'reset' });
  }

  /** Advances exactly one frame while paused. */
  stepFrame(): void {
    if (this.state.status !== 'paused' || this.inFlight) return;
    this.inFlight = true;
    this.send({ type: 'run', frames: 1 });
  }

  setSpeed(speed: number): void {
    this.update({ speed });
  }

  setPalette(palette: Palette): void {
    this.send({ type: 'palette', palette });
    // Redraw the paused frame in the new colors.
    if (this.state.status === 'paused') this.stepFrame();
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
    this.worker?.terminate();
    this.listeners.clear();
  }

  // --- Frame loop -----------------------------------------------------------------------

  private startLoop(): void {
    if (this.rafId) return;
    this.lastTime = performance.now();
    this.secondStart = this.lastTime;
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
      this.send({ type: 'run', frames });
      this.framesThisSecond += frames;
    }

    if (now - this.secondStart >= 1000) {
      const fps = Math.round((this.framesThisSecond * 1000) / (now - this.secondStart));
      this.secondStart = now;
      this.framesThisSecond = 0;
      if (fps !== this.state.fps) this.update({ fps });
    }
  };

  private receive(message: HostMessage): void {
    switch (message.type) {
      case 'loaded':
        this.update({ status: 'running', header: message.header, error: null });
        this.startLoop();
        break;
      case 'error':
        // A bad file while a game is loaded leaves that game running and just reports.
        if (!this.state.header) this.stopLoop();
        this.update({
          status: this.state.header ? this.state.status : 'error',
          error: message.message,
        });
        break;
      case 'frame':
        this.inFlight = false;
        if (!message.pixels) break;
        if (this.canvas) {
          this.image ??= new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
          this.image.data.set(new Uint8ClampedArray(message.pixels));
          this.canvas.putImageData(this.image, 0, 0);
        }
        this.send({ type: 'recycle', pixels: message.pixels }, [message.pixels]);
        break;
    }
  }

  // --- Input ----------------------------------------------------------------------------

  private pollGamepads(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const now = new Set<ButtonId>();
    for (const pad of pads) {
      if (!pad) continue;
      for (const [index, button] of GAMEPAD_BUTTONS) {
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

const SOURCE_BITS: Record<InputSource, number> = { keyboard: 1, touch: 2, gamepad: 4 };

const GAMEPAD_AXES = {
  up: Button.Up,
  down: Button.Down,
  left: Button.Left,
  right: Button.Right,
} as const;
