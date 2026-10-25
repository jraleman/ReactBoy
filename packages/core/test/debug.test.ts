import { describe, expect, it } from 'vitest';
import { Debugger, GameBoy, IO, PpuMode, snapshot } from '../src';
import { makeRom } from './helpers/rom-builder';

/** Places code at absolute addresses from 0x0100. */
function program(blocks: Record<number, number[]>): number[] {
  const bytes: number[] = [];
  for (const [addr, code] of Object.entries(blocks)) {
    code.forEach((byte, i) => (bytes[Number(addr) - 0x100 + i] = byte));
  }
  return Array.from(bytes, (byte) => byte ?? 0x00);
}

/** A loop that calls a routine, which calls another; both increment A. */
const nested = makeRom(
  program({
    0x100: [0x31, 0xfe, 0xdf], // LD SP,0xDFFE
    0x103: [0xcd, 0x10, 0x01], // loop: CALL outer
    0x106: [0xea, 0x00, 0xc0], // LD (0xC000),A
    0x109: [0x18, 0xf8], // JR loop
    0x110: [0x3c, 0xcd, 0x20, 0x01, 0xc9], // outer: INC A; CALL inner; RET
    0x120: [0x3c, 0xc9], // inner: INC A; RET
  }),
);

function setup() {
  const gb = new GameBoy(nested);
  return { gb, debug: new Debugger(gb) };
}

/** Steps into instructions until PC reaches `pc`. */
function stepTo(debug: Debugger, gb: GameBoy, pc: number) {
  for (let i = 0; i < 100 && gb.cpu.pc !== pc; i++) debug.step('into');
  expect(gb.cpu.pc).toBe(pc);
}

describe('Debugger', () => {
  it('runs exactly like the plain machine when nothing is set', () => {
    const plain = new GameBoy(nested);
    const { gb, debug } = setup();
    for (let i = 0; i < 5; i++) {
      plain.runFrame();
      expect(debug.runFrame()).toBeNull();
    }
    expect(gb.serialize(0)).toEqual(plain.serialize(0));
  });

  it('stops before an instruction at a breakpoint and continues past it', () => {
    const { gb, debug } = setup();
    debug.setBreakpoints([{ addr: 0x120 }]);
    expect(debug.runFrame()).toEqual({ type: 'breakpoint', pc: 0x120 });
    expect(gb.cpu.pc).toBe(0x120);
    const a = gb.cpu.r[7];

    // Continuing runs the instruction and stops on the next pass through the loop.
    const cycles = gb.cycles;
    expect(debug.runFrame()).toEqual({ type: 'breakpoint', pc: 0x120 });
    expect(gb.cycles).toBeGreaterThan(cycles + 40);
    expect(gb.cpu.r[7]).toBe((a! + 2) & 0xff);
  });

  it('stops after an instruction that writes a watched address', () => {
    const { gb, debug } = setup();
    debug.setWatchpoints([{ addr: 0xc000, read: false, write: true }]);
    expect(debug.runFrame()).toEqual({
      type: 'watchpoint',
      pc: 0x109,
      at: 0x106,
      access: 'write',
      addr: 0xc000,
      value: 3, // A starts at 0x01 after boot, plus two increments
    });
    expect(gb.cpu.pc).toBe(0x109);

    debug.setWatchpoints([]);
    expect(gb.onWrite).toBeNull();
    expect(debug.runFrame()).toBeNull();
  });

  it('stops after an instruction that reads a watched address, but not on fetches', () => {
    const gb = new GameBoy(
      makeRom(
        program({
          0x100: [0xfa, 0x00, 0xc0], // loop: LD A,(0xC000)
          0x103: [0x18, 0xfb], // JR loop
        }),
      ),
    );
    const debug = new Debugger(gb);
    gb.mmu.wram[0] = 0x5a;
    debug.setWatchpoints([{ addr: 0xc000, read: true, write: false }]);
    expect(gb.onWrite).toBeNull();
    expect(debug.runFrame()).toEqual({
      type: 'watchpoint',
      pc: 0x103,
      at: 0x100,
      access: 'read',
      addr: 0xc000,
      value: 0x5a,
    });

    // The instruction's own operand bytes are fetched, not read as data.
    debug.setWatchpoints([{ addr: 0x101, read: true, write: true }]);
    expect(debug.runFrame()).toBeNull();
    debug.detach();
    expect([gb.onRead, gb.onWrite]).toEqual([null, null]);
  });

  it('limits a breakpoint in switchable ROM to one bank', () => {
    const rom = makeRom(
      program({
        0x100: [0x31, 0xfe, 0xdf], // LD SP,0xDFFE
        0x103: [0x3e, 0x02, 0xea, 0x00, 0x20], // loop: LD A,2; LD (0x2000),A
        0x108: [0xcd, 0x00, 0x40], // CALL 0x4000
        0x10b: [0x3e, 0x03, 0xea, 0x00, 0x20], // LD A,3; LD (0x2000),A
        0x110: [0xcd, 0x00, 0x40], // CALL 0x4000
        0x113: [0x18, 0xee], // JR loop
      }),
      { type: 0x01, romSizeCode: 2 }, // MBC1, 8 banks
    );
    rom[2 * 0x4000] = rom[3 * 0x4000] = 0xc9; // RET in banks 2 and 3
    const gb = new GameBoy(rom);
    const debug = new Debugger(gb);
    debug.setBreakpoints([{ addr: 0x4000, bank: 3 }]);
    for (let i = 0; i < 2; i++) {
      expect(debug.runFrame()).toEqual({ type: 'breakpoint', pc: 0x4000 });
      expect(gb.mbc.romBank).toBe(3);
    }
    // Banks only qualify the switchable area; elsewhere the breakpoint always applies.
    debug.setBreakpoints([{ addr: 0x108, bank: 5 }]);
    expect(debug.runFrame()).toEqual({ type: 'breakpoint', pc: 0x108 });
  });

  it('pokes memory past the PPU, leaves ROM alone and stays out of watchpoints', () => {
    const { gb, debug } = setup();
    debug.setWatchpoints([{ addr: 0xc000, read: true, write: true }]);
    while (gb.ppu.mode !== PpuMode.Drawing) gb.step();
    gb.poke(0x8000, 0x42);
    gb.poke(0xfe00, 0x43);
    gb.poke(0xc000, 0x44);
    gb.poke(0x0100, 0x45);
    expect([gb.peek(0x8000), gb.peek(0xfe00), gb.peek(0xc000)]).toEqual([0x42, 0x43, 0x44]);
    expect(gb.peek(0x0100)).toBe(0x31);
    gb.poke(0xff47, 0x1b); // BGP, as the CPU would write it
    expect(gb.ppu.bgp).toBe(0x1b);
    // The first stop is the program's own write, not the poke.
    expect(debug.runFrame()).toMatchObject({ type: 'watchpoint', at: 0x106, access: 'write' });
  });

  it('steps into, over and out of calls', () => {
    const { gb, debug } = setup();
    stepTo(debug, gb, 0x103);

    expect(debug.step('into')).toBe(true);
    expect(gb.cpu.pc).toBe(0x110);

    // Inside outer: step over INC, then over the CALL to inner, which has to run.
    expect(debug.step('over')).toBe(true);
    expect(gb.cpu.pc).toBe(0x111);
    expect(debug.step('over')).toBe(false);
    expect(debug.stepping).toBe(true);
    expect(debug.runFrame()).toEqual({ type: 'step', pc: 0x114 });
    expect(debug.stepping).toBe(false);

    // Back at the loop, then out of inner from its first instruction.
    stepTo(debug, gb, 0x120);
    expect(debug.step('out')).toBe(false);
    expect(debug.runFrame()).toEqual({ type: 'step', pc: 0x114 });
    expect(debug.step('out')).toBe(false);
    expect(debug.runFrame()).toEqual({ type: 'step', pc: 0x106 });
  });

  it('stops a step over at a breakpoint inside the call', () => {
    const { gb, debug } = setup();
    stepTo(debug, gb, 0x103);
    debug.setBreakpoints([{ addr: 0x120 }]);
    expect(debug.step('over')).toBe(false);
    expect(debug.runFrame()).toEqual({ type: 'breakpoint', pc: 0x120 });
    expect(debug.stepping).toBe(false);
  });

  it('peeks at VRAM while the PPU blocks the CPU', () => {
    const { gb, debug } = setup();
    gb.ppu.vram[0] = 0x42;
    while (gb.ppu.mode !== PpuMode.Drawing) gb.step();
    expect(gb.read(0x8000)).toBe(0xff);
    expect(gb.peek(0x8000)).toBe(0x42);
    expect(debug.snapshot().memory[0x8000]).toBe(0x42);
  });

  it('snapshots registers and memory', () => {
    const { gb, debug } = setup();
    stepTo(debug, gb, 0x110);
    const snapshot = debug.snapshot();
    expect(snapshot).toMatchObject({ pc: 0x110, sp: 0xdffc, cpu: 'running', romBank: 1 });
    expect(snapshot.memory[0xdffc]).toBe(0x06);
    expect(snapshot.memory[0xdffd]).toBe(0x01);
    expect(snapshot.memory[0x0110]).toBe(0x3c);
    expect([snapshot.model, snapshot.color]).toEqual(['dmg', null]);
  });

  it('snapshots both VRAM banks and palette RAM on a Game Boy Color', () => {
    const gb = new GameBoy(nested, { model: 'cgb' });
    gb.write(IO.LCDC, 0x00);
    gb.write(IO.VBK, 1);
    gb.write(0x8000, 0x42);
    gb.write(IO.BCPS, 0x82);
    gb.write(IO.BCPD, 0x1f);
    gb.write(IO.OCPS, 0x3f);
    gb.write(IO.OCPD, 0x7c);
    const { memory, model, color } = snapshot(gb);
    expect(model).toBe('cgb');
    expect([memory[0x8000], color!.vram[0], color!.vram[0x2000]]).toEqual([0x42, 0, 0x42]);
    expect([color!.bgPalettes[2], color!.objPalettes[63]]).toEqual([0x1f, 0x7c]);
  });
});
