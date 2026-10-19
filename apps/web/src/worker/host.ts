import { GameBoy, PALETTES, type Palette } from '@reactboy/core';
import type { ClientMessage, HostMessage, Post } from './protocol';

/**
 * Owns the emulator and answers {@link ClientMessage}s. Runs inside the Web Worker, or on
 * the main thread when workers are unavailable — the protocol is identical either way.
 */
export function createEmulatorHost(post: Post<HostMessage>): (message: ClientMessage) => void {
  let gb: GameBoy | null = null;
  let rom: Uint8Array | null = null;
  let palette: Palette = PALETTES.classic;
  // Framebuffers bounce between threads; reuse them instead of allocating one per frame.
  const pool: ArrayBuffer[] = [];

  /** Starts `image`; on failure the current game (if any) keeps running untouched. */
  const boot = (image: Uint8Array) => {
    try {
      gb = new GameBoy(image, { palette });
      rom = image;
      post({ type: 'loaded', header: gb.header });
      sendFrame();
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const sendFrame = () => {
    if (!gb) {
      post({ type: 'frame', pixels: null, frameCount: 0 });
      return;
    }
    const source = gb.framebuffer;
    const pixels = pool.pop() ?? new ArrayBuffer(source.byteLength);
    new Uint8ClampedArray(pixels).set(source);
    post({ type: 'frame', pixels, frameCount: gb.ppu.frameCount }, [pixels]);
  };

  return (message) => {
    switch (message.type) {
      case 'load':
        boot(new Uint8Array(message.rom));
        break;
      case 'reset':
        if (rom) boot(rom);
        break;
      case 'run':
        // Always answer, so the client's in-flight request never dangles.
        if (gb) for (let i = 0; i < message.frames; i++) gb.runFrame();
        sendFrame();
        break;
      case 'button':
        gb?.setButton(message.button, message.pressed);
        break;
      case 'palette':
        palette = message.palette;
        gb?.setPalette(palette);
        break;
      case 'recycle':
        if (pool.length < 4) pool.push(message.pixels);
        break;
    }
  };
}
