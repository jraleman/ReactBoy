import { GameBoy, PALETTES, type Palette } from '@reactboy/core';
import type { ClientMessage, HostMessage, Post } from './protocol';

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

  /** Starts `image`; on failure the current game (if any) keeps running untouched. */
  const boot = (
    image: Uint8Array,
    imageKey: string,
    battery: Uint8Array | null,
    state: Uint8Array | null,
  ) => {
    let next: GameBoy;
    try {
      next = new GameBoy(image, { palette });
    } catch (error) {
      post({ type: 'error', key: imageKey, message: messageOf(error) });
      return;
    }
    flushBattery();
    next.apu.setSampleRate(sampleRate);
    next.apu.channelMask = channels;
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
    gb = next;
    rom = image;
    key = imageKey;
    post({ type: 'loaded', key, header: gb.header, resumed });
  };

  const sendFrame = () => {
    if (!gb) {
      post({ type: 'frame', pixels: null, audio: null, frameCount: 0 });
      return;
    }
    const source = gb.framebuffer;
    const pixels = pool.pop() ?? new ArrayBuffer(source.byteLength);
    new Uint8ClampedArray(pixels).set(source);
    const samples = gb.apu.takeSamples();
    const audio = samples.length > 0 ? (samples.slice().buffer as ArrayBuffer) : null;
    const transfer = audio ? [pixels, audio] : [pixels];
    post({ type: 'frame', pixels, audio, frameCount: gb.ppu.frameCount }, transfer);
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
          for (let i = 0; i < message.frames; i++) gb.runFrame();
          framesSinceFlush += message.frames;
          if (framesSinceFlush >= BATTERY_FLUSH_FRAMES) flushBattery();
        }
        sendFrame();
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
        if (!gb) return reply(message.id, null, 'No game is running.');
        try {
          gb.deserialize(new Uint8Array(message.state));
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
