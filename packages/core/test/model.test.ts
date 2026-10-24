import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GameBoy, IO, parseHeader, preferredModel, UnsupportedCartridgeError } from '../src';
import { makeRom } from './helpers/rom-builder';

const T0 = 1_700_000_000_000;
const spin = [0x18, 0xfe]; // JR -2

describe('models', () => {
  it('starts as a DMG unless asked to be a Game Boy Color', () => {
    const dmg = new GameBoy(makeRom(spin));
    expect(dmg.model).toBe('dmg');
    expect(dmg.cpu.af).toBe(0x01b0);

    const cgb = new GameBoy(makeRom(spin), { model: 'cgb' });
    expect([cgb.cpu.af, cgb.cpu.bc, cgb.cpu.de, cgb.cpu.hl]).toEqual([
      0x1180, 0x0000, 0xff56, 0x000d,
    ]);
  });

  it('plays color-only games only on a Game Boy Color', () => {
    const rom = makeRom(spin, { title: 'COLOR ONLY', cgbFlag: 0xc0 });
    expect(() => new GameBoy(rom)).toThrow(UnsupportedCartridgeError);
    expect(() => new GameBoy(rom)).toThrow('"COLOR ONLY" requires a Game Boy Color.');
    expect(new GameBoy(rom, { model: 'cgb' }).model).toBe('cgb');
    // Games that work on both run on either.
    expect(() => new GameBoy(makeRom(spin, { cgbFlag: 0x80 }))).not.toThrow();
  });

  it('prefers color mode for games whose header asks for it', () => {
    const model = (cgbFlag: number) => preferredModel(parseHeader(makeRom(spin, { cgbFlag })));
    expect([model(0x00), model(0x80), model(0xc0)]).toEqual(['dmg', 'cgb', 'cgb']);
  });
});

describe('Game Boy Color banking', () => {
  it('switches VRAM banks with VBK', () => {
    const gb = new GameBoy(makeRom(spin), { model: 'cgb' });
    gb.write(0x8000, 0x11);
    gb.write(IO.VBK, 0xff);
    expect(gb.read(IO.VBK)).toBe(0xff);
    expect(gb.read(0x8000)).toBe(0x00);
    gb.write(0x9fff, 0x22);
    expect(gb.peek(0x9fff)).toBe(0x22);
    gb.write(IO.VBK, 0x00);
    expect(gb.read(IO.VBK)).toBe(0xfe);
    expect([gb.read(0x8000), gb.read(0x9fff)]).toEqual([0x11, 0x00]);
    expect([gb.ppu.vram[0x0000], gb.ppu.vram[0x3fff]]).toEqual([0x11, 0x22]);
  });

  it('switches the WRAM bank at 0xD000 with SVBK, and bank 0 gives bank 1', () => {
    const gb = new GameBoy(makeRom(spin), { model: 'cgb' });
    gb.write(0xc000, 0xc0);
    for (let bank = 1; bank < 8; bank++) {
      gb.write(IO.SVBK, bank);
      gb.write(0xd000, bank * 0x10);
    }
    for (let bank = 1; bank < 8; bank++) {
      gb.write(IO.SVBK, bank);
      expect(gb.read(IO.SVBK)).toBe(0xf8 | bank);
      expect(gb.read(0xd000)).toBe(bank * 0x10);
      // Echo RAM follows the bank, and 0xC000 never changes.
      expect(gb.read(0xf000)).toBe(bank * 0x10);
      expect(gb.read(0xc000)).toBe(0xc0);
    }
    gb.write(IO.SVBK, 0);
    expect(gb.read(IO.SVBK)).toBe(0xf9);
    expect(gb.read(0xd000)).toBe(0x10);
  });

  it('keeps bytes in the spare registers and reports OAM-index sprite priority', () => {
    const gb = new GameBoy(makeRom(spin), { model: 'cgb' });
    for (const addr of [0xff72, 0xff73, 0xff74, 0xff75]) gb.write(addr, 0xff);
    expect([0xff72, 0xff73, 0xff74, 0xff75].map((addr) => gb.read(addr))).toEqual([
      0xff, 0xff, 0xff, 0xff,
    ]);
    gb.write(0xff72, 0x5a);
    gb.write(0xff75, 0x00);
    expect([gb.read(0xff72), gb.read(0xff75)]).toEqual([0x5a, 0x8f]);
    expect(gb.read(IO.OPRI)).toBe(0xfe);
  });

  it('has none of this on a DMG', () => {
    const gb = new GameBoy(makeRom(spin));
    gb.write(0x8000, 0x11);
    gb.write(0xd000, 0x33);
    const registers = [IO.VBK, IO.BCPS, IO.BCPD, IO.OCPS, IO.OCPD, IO.OPRI, IO.SVBK];
    for (const addr of [...registers, 0xff72, 0xff73, 0xff74, 0xff75]) {
      gb.write(addr, 0x01);
      expect(gb.read(addr)).toBe(0xff);
    }
    gb.write(IO.SVBK, 0x02);
    expect([gb.read(0x8000), gb.read(0xd000)]).toEqual([0x11, 0x33]);
  });
});

/** Mixes a WRAM counter, DIV and TIMA into WRAM and the scroll register, so frames differ. */
const busy = makeRom([
  ...[0x3e, 0x91, 0xe0, 0x40], // LD A,0x91; LDH (LCDC),A
  ...[0x3e, 0x05, 0xe0, 0x07], // LD A,0x05; LDH (TAC),A
  ...[0x21, 0x00, 0xc0], // LD HL,0xC000
  0x34, // loop: INC (HL)
  ...[0xf0, 0x04], // LDH A,(DIV)
  0x86, // ADD A,(HL)
  ...[0xe0, 0x43], // LDH (SCX),A
  ...[0xf0, 0x05], // LDH A,(TIMA)
  ...[0xea, 0x01, 0xc0], // LD (0xC001),A
  ...[0x18, 0xf3], // JR loop
]);

describe('save states across models', () => {
  it('round-trips the banks, registers and palettes of a Game Boy Color', () => {
    const a = new GameBoy(busy, { model: 'cgb' });
    a.write(IO.BCPS, 0x80);
    a.write(IO.BCPD, 0x1f);
    a.write(IO.OCPS, 0x07);
    a.write(IO.OCPD, 0x42);
    a.write(IO.VBK, 1);
    a.write(0x8123, 0x77);
    a.write(IO.SVBK, 5);
    a.write(0xd456, 0x88);
    a.write(0xff73, 0x99);
    for (let i = 0; i < 5; i++) a.runFrame();
    const b = new GameBoy(busy, { model: 'cgb' });
    b.deserialize(a.serialize(T0), T0);
    expect([b.read(IO.VBK), b.read(IO.SVBK), b.read(0xff73)]).toEqual([0xff, 0xfd, 0x99]);
    expect([b.peek(0x8123), b.read(0xd456)]).toEqual([0x77, 0x88]);
    expect([b.read(IO.BCPS), b.ppu.bgPalettes[0], b.read(IO.OCPS), b.ppu.objPalettes[7]]).toEqual([
      0xc1, 0x1f, 0x47, 0x42,
    ]);
    expect(b.framebuffer).toEqual(a.framebuffer);
    expect(b.serialize(T0)).toEqual(a.serialize(T0));
  });

  it('refuses a state from the other model, which it can tell beforehand', () => {
    const cgb = new GameBoy(busy, { model: 'cgb' });
    const dmg = new GameBoy(busy);
    expect(() => dmg.deserialize(cgb.serialize())).toThrow(/from a Game Boy Color/);
    expect(() => cgb.deserialize(dmg.serialize())).toThrow(/from a Game Boy\./);
    expect([GameBoy.stateModel(cgb.serialize()), GameBoy.stateModel(dmg.serialize())]).toEqual([
      'cgb',
      'dmg',
    ]);
    expect(() => GameBoy.stateModel(new Uint8Array(2))).toThrow('not a ReactBoy save state');
  });

  it('loads a version 2 state, saved before there were models, as a DMG', () => {
    // `busy` after 30 frames and a step, saved by ReactBoy before version 3.
    const v2 = gunzipSync(readFileSync(new URL('fixtures/busy-state-v2.bin.gz', import.meta.url)));
    expect(v2[4]).toBe(2);
    expect(GameBoy.stateModel(v2)).toBe('dmg');
    expect(() => new GameBoy(busy, { model: 'cgb' }).deserialize(v2, T0)).toThrow(
      /from a Game Boy\./,
    );

    const fresh = new GameBoy(busy);
    for (let i = 0; i < 30; i++) fresh.runFrame();
    fresh.step();
    const loaded = new GameBoy(busy);
    loaded.deserialize(new Uint8Array(v2), T0);
    expect(loaded.serialize(T0)).toEqual(fresh.serialize(T0));
  });
});
