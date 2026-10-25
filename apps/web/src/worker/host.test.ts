import { describe, expect, it } from 'vitest';
import { createEmulatorHost } from './host';
import type { HostMessage } from './protocol';

/** A valid ROM header around `program` at 0x0100, asking for color. */
function makeColorRom(program: number[]): ArrayBuffer {
  const rom = new Uint8Array(0x8000);
  rom.set(program, 0x100);
  rom[0x143] = 0x80;
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom.buffer;
}

/** Paints the screen in background color 0 of palette 0, set to pure red, then spins. */
const redRom = makeColorRom([
  ...[0xaf, 0xe0, 0x40], // XOR A; LDH (LCDC),A — palette RAM is out of reach while drawing
  ...[0x3e, 0x80, 0xe0, 0x68], // LD A,$80; LDH (BCPS),A
  ...[0x3e, 0x1f, 0xe0, 0x69], // LD A,$1F; LDH (BCPD),A
  ...[0xaf, 0xe0, 0x69], // XOR A; LDH (BCPD),A
  ...[0x3e, 0x91, 0xe0, 0x40], // LD A,$91; LDH (LCDC),A
  ...[0x18, 0xfe], // JR -2
]);

function host() {
  const messages: HostMessage[] = [];
  const send = createEmulatorHost((message) => messages.push(message));
  /** Runs `frames` frames and returns the middle pixel as 0xRRGGBB. */
  const run = (frames: number) => {
    send({ type: 'run', frames });
    const frame = messages.findLast((m) => m.type === 'frame')!;
    const [r, g, b] = new Uint8Array(frame.pixels!, (72 * 160 + 80) * 4);
    return (r! << 16) | (g! << 8) | b!;
  };
  return { messages, send, run };
}

describe('createEmulatorHost', () => {
  it('reports the model and shows color games with the chosen color correction', () => {
    const { messages, send, run } = host();
    send({ type: 'load', rom: redRom, key: 'red', battery: null, state: null });
    expect(messages.map((m) => m.type)).toEqual(['model', 'loaded']);
    expect(messages[0]).toEqual({ type: 'model', model: 'cgb' });

    // Red as the handheld's screen showed it, then at full strength.
    expect(run(3)).toBe(0xcf0030);
    send({ type: 'color-correction', correction: 'raw' });
    expect(run(0)).toBe(0xff0000);

    // It stays chosen for the next game, and an unchanged model isn't reported again.
    send({ type: 'reset' });
    expect(messages.filter((m) => m.type === 'model')).toHaveLength(1);
    expect(run(3)).toBe(0xff0000);
  });
});
