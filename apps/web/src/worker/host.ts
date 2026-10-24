import {
  Debugger,
  GameBoy,
  PALETTES,
  parseHeader,
  preferredModel,
  snapshot,
  type BreakReason,
  type BusActivity,
  type Model,
  type Palette,
} from '@reactboy/core';
import { LinkCable } from './link';
import type { ClientMessage, DebugReport, HostMessage, Post } from './protocol';

/** Frames between battery reports while a game keeps writing to cartridge RAM (~2 s). */
const BATTERY_FLUSH_FRAMES = 120;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Owns the emulator and answers {@link ClientMessage}s. Runs inside the Web Worker, or on
 * the main thread when workers are unavailable — the protocol is identical either way.
 */
export function createEmulatorHost(post: Post<HostMessage>): (message: ClientMessage) => void {
  let gb: GameBoy | null = null;
  let rom: Uint8Array | null = null;
  let key = '';
  let palette: Palette = PALETTES.classic;
  let sampleRate = 0;
  let channels = 0x0f;
  let framesSinceFlush = 0;
  let debugConfig: Omit<Extract<ClientMessage, { type: 'debug' }>, 'type'> = {
    enabled: false,
    breakpoints: [],
    watchpoints: [],
  };
  let debug: Debugger | null = null;
  const cable = new LinkCable((status) => post({ type: 'link', status }));
  // Framebuffers bounce between threads; reuse them instead of allocating one per frame.
  const pool: ArrayBuffer[] = [];

  /** Reports battery RAM that changed since it was last reported. */
  const flushBattery = () => {
    framesSinceFlush = 0;
    if (!gb?.batteryDirty) return;
    const data = gb.exportBattery()!;
    gb.batteryDirty = false;
    post({ type: 'battery', key, data: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer]);
  };

  const create = (image: Uint8Array, model: Model) => {
    const next = new GameBoy(image, { palette, model });
    next.apu.setSampleRate(sampleRate);
    next.apu.channelMask = channels;
    return next;
  };

  /**
   * Color mode for games that ask for it, unless resuming a state saved on the other model
   * (such as one from before games ran in color), which carries on as it was.
   */
  const modelFor = (image: Uint8Array, state: Uint8Array | null): Model => {
    if (state) {
      try {
        return GameBoy.stateModel(state);
      } catch {
        // Not a state this version can load; boot() falls back to the battery save.
      }
    }
    return preferredModel(parseHeader(image));
  };

  /** Swaps in `next` as the running machine. */
  const install = (next: GameBoy) => {
    gb = next;
    cable.plug(gb.serial);
    attachDebugger();
  };

  /** Starts `image`; on failure the current game (if any) keeps running untouched. */
  const boot = (
    image: Uint8Array,
    imageKey: string,
    battery: Uint8Array | null,
    state: Uint8Array | null,
  ) => {
    let next: GameBoy;
    try {
      next = create(image, modelFor(image, state));
    } catch (error) {
      post({ type: 'error', key: imageKey, message: messageOf(error) });
      return;
    }
    flushBattery();
    if (battery) next.importBattery(battery);
    let resumed = false;
    if (state) {
      try {
        next.deserialize(state);
        resumed = true;
      } catch {
        // A state from an older version: start from the battery save instead.
      }
    }
    rom = image;
    key = imageKey;
    install(next);
    post({ type: 'loaded', key, header: next.header, resumed });
  };

  /** (Re)creates the debugger for the current game, or drops it when it is off. */
  const attachDebugger = () => {
    debug?.detach();
    debug = null;
    if (!gb || !debugConfig.enabled) return;
    debug = new Debugger(gb);
    debug.setBreakpoints(debugConfig.breakpoints);
    debug.setWatchpoints(debugConfig.watchpoints);
  };

  const report = (stop: BreakReason | null): DebugReport | null =>
    debug && { snapshot: debug.snapshot(), stop, stepping: debug.stepping };

  /** A look at the machine for the case's parts view, which works without the debugger. */
  const inspect = (): DebugReport | null =>
    report(null) ?? (gb && { snapshot: snapshot(gb), stop: null, stepping: false });

  const sendFrame = (
    debugReport: DebugReport | null = null,
    activity: BusActivity | null = null,
  ) => {
    if (!gb) {
      post({ type: 'frame', pixels: null, audio: null, frameCount: 0, debug: null, activity });
      return;
    }
    const source = gb.framebuffer;
    const pixels = pool.pop() ?? new ArrayBuffer(source.byteLength);
    new Uint8ClampedArray(pixels).set(source);
    const samples = gb.apu.takeSamples();
    const audio = samples.length > 0 ? (samples.slice().buffer as ArrayBuffer) : null;
    const transfer = audio ? [pixels, audio] : [pixels];
    if (debugReport) transfer.push(debugReport.snapshot.memory.buffer as ArrayBuffer);
    post(
      {
        type: 'frame',
        pixels,
        audio,
        frameCount: gb.ppu.frameCount,
        debug: debugReport,
        activity,
      },
      transfer,
    );
  };

  const reply = (id: number, data: Uint8Array | null, error: string | null = null) => {
    const buffer = (data?.buffer as ArrayBuffer | undefined) ?? null;
    post({ type: 'reply', id, data: buffer, error }, buffer ? [buffer] : []);
  };

  return (message) => {
    switch (message.type) {
      case 'load': {
        const { battery, state } = message;
        boot(
          new Uint8Array(message.rom),
          message.key,
          battery && new Uint8Array(battery),
          state && new Uint8Array(state),
        );
        break;
      }
      case 'reset':
        if (!gb || !rom) break;
        if (message.battery) {
          boot(rom, key, new Uint8Array(message.battery), null);
          // An imported save replaces the stored one straight away.
          gb.batteryDirty = true;
          flushBattery();
        } else {
          boot(rom, key, gb.exportBattery(), null);
        }
        break;
      case 'run':
        // Always answer, so the client's in-flight request never dangles.
        if (gb) {
          let stop: BreakReason | null = null;
          for (let i = 0; i < message.frames && !stop; i++) {
            if (debug) stop = debug.runFrame();
            else gb.runFrame();
          }
          framesSinceFlush += message.frames;
          if (framesSinceFlush >= BATTERY_FLUSH_FRAMES) flushBattery();
          sendFrame(
            stop ? report(stop) : message.inspect ? inspect() : null,
            message.activity ? gb.takeActivity() : null,
          );
        } else {
          sendFrame();
        }
        break;
      case 'debug':
        debugConfig = message;
        attachDebugger();
        break;
      case 'step':
        if (gb && debug) debug.step(message.mode);
        sendFrame(report(null));
        break;
      case 'link':
        cable.setEnabled(message.enabled);
        break;
      case 'cancel-step':
        debug?.cancelStep();
        break;
      case 'poke':
        if (gb && debug) gb.poke(message.addr, message.value);
        sendFrame(report(null));
        break;
      case 'button':
        gb?.setButton(message.button, message.pressed);
        break;
      case 'palette':
        palette = message.palette;
        gb?.setPalette(palette);
        break;
      case 'audio':
        sampleRate = message.sampleRate;
        channels = message.channels;
        gb?.apu.setSampleRate(sampleRate);
        if (gb) gb.apu.channelMask = channels;
        break;
      case 'recycle':
        if (pool.length < 4) pool.push(message.pixels);
        break;
      case 'snapshot':
        if (!gb) return reply(message.id, null, 'No game is running.');
        flushBattery();
        reply(message.id, gb.serialize());
        break;
      case 'restore':
        if (!gb || !rom) return reply(message.id, null, 'No game is running.');
        try {
          const state = new Uint8Array(message.state);
          const model = GameBoy.stateModel(state);
          if (model === gb.model) {
            gb.deserialize(state);
          } else {
            const next = create(rom, model);
            next.deserialize(state);
            install(next);
          }
          reply(message.id, null);
        } catch (error) {
          reply(message.id, null, messageOf(error));
        }
        break;
      case 'export-battery':
        reply(message.id, gb?.exportBattery() ?? null);
        break;
    }
  };
}
