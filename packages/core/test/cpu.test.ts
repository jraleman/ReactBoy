import { describe, expect, it } from 'vitest';
import { GameBoy } from '../src';
import { A, F, FLAG_C, FLAG_H, FLAG_N, FLAG_Z } from '../src/cpu/registers';
import { makeRom } from './helpers/rom-builder';

/** Boots a ROM whose entry point holds `program`, with interrupts off and the LCD on. */
const boot = (program: number[]) => new GameBoy(makeRom(program));

/** Executes `count` instructions and returns the T-cycles taken by each. */
const run = (gb: GameBoy, count: number) => Array.from({ length: count }, () => gb.step());

describe('CPU', () => {
  it('starts from the DMG post-boot register state', () => {
    const { cpu } = boot([]);
    expect([cpu.af, cpu.bc, cpu.de, cpu.hl, cpu.sp, cpu.pc]).toEqual([
      0x01b0, 0x0013, 0x00d8, 0x014d, 0xfffe, 0x0100,
    ]);
  });

  it('computes half-carry and carry for ADD and SUB', () => {
    const gb = boot([0x3e, 0x0f, 0xc6, 0x01, 0x3e, 0x10, 0xd6, 0x20]); // LD A,0F; ADD 1; LD A,10; SUB 20
    run(gb, 2);
    expect(gb.cpu.r[A]).toBe(0x10);
    expect(gb.cpu.r[F]).toBe(FLAG_H);
    run(gb, 2);
    expect(gb.cpu.r[A]).toBe(0xf0);
    expect(gb.cpu.r[F]).toBe(FLAG_N | FLAG_C);
  });

  it('adjusts BCD with DAA after addition', () => {
    const gb = boot([0x3e, 0x45, 0xc6, 0x38, 0x27]); // LD A,45; ADD 38; DAA -> 83
    run(gb, 3);
    expect(gb.cpu.r[A]).toBe(0x83);
    expect(gb.cpu.r[F]! & FLAG_Z).toBe(0);
  });

  it('masks the low nibble of F on POP AF', () => {
    const gb = boot([0x01, 0xff, 0x12, 0xc5, 0xf1]); // LD BC,12FF; PUSH BC; POP AF
    run(gb, 3);
    expect(gb.cpu.af).toBe(0x12f0);
  });

  it('takes the documented number of cycles', () => {
    // NOP; JR NZ (not taken, Z set); CALL a16; (at 0x0200) RET; LD (HL),d8; PUSH BC; POP BC
    const program = [0x00, 0x20, 0x00, 0xcd, 0x00, 0x02, 0x36, 0x00, 0xc5, 0xc1];
    const rom = makeRom(program);
    rom[0x200] = 0xc9;
    const gb = new GameBoy(rom);
    gb.cpu.hl = 0xc000;
    expect(run(gb, 7)).toEqual([4, 8, 24, 16, 12, 16, 12]);
  });

  it('delays EI by one instruction', () => {
    // EI; INC A; (interrupt here) ...
    const gb = boot([0xfb, 0x3c, 0x3c]);
    gb.interrupts.enable = 0x04;
    gb.interrupts.flags = 0x04;
    run(gb, 2);
    expect(gb.cpu.pc).toBe(0x102);
    gb.step();
    expect(gb.cpu.pc).toBe(0x50); // timer vector
    expect(gb.interrupts.flags & 0x04).toBe(0);
  });

  it('reproduces the HALT bug when IME is off and an interrupt is pending', () => {
    // HALT; INC A — the INC is executed twice because PC fails to advance once.
    const gb = boot([0x76, 0x3c, 0x00]);
    gb.interrupts.enable = 0x01;
    gb.interrupts.flags = 0x01;
    gb.cpu.r[A] = 0;
    run(gb, 3);
    expect(gb.cpu.r[A]).toBe(2);
    expect(gb.cpu.pc).toBe(0x102);
  });

  it('locks up on illegal opcodes', () => {
    const gb = boot([0xd3, 0x3c]);
    run(gb, 3);
    expect(gb.cpu.locked).toBe(true);
    expect(gb.cpu.pc).toBe(0x101);
  });
});
