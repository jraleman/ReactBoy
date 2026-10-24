import { describe, expect, it, vi } from 'vitest';
import { CLOCK_HZ, CYCLES_PER_FRAME, GameBoy, IO } from '../src';
import { makeRom } from './helpers/rom-builder';

const T0 = 1_700_000_000_000;
const switchSpeed = makeRom([
  ...[0x3e, 0x01], // LD A,1
  ...[0xe0, 0x4d], // LDH (KEY1),A
  ...[0x10, 0x00], // STOP
  ...[0x18, 0xf8], // JR -8: switch back the next time round
]);

/** Runs `switchSpeed` up to its STOP and returns the T-cycles the STOP took. */
function runToSwitch(gb: GameBoy): number {
  while (gb.peek(gb.cpu.pc) !== 0x10) gb.step();
  return gb.step();
}

/** CPU M-cycles from the start of one frame to the next. */
function mCyclesPerFrame(gb: GameBoy): number {
  let frame = gb.ppu.frameCount;
  while (gb.ppu.frameCount === frame) gb.tick();
  frame = gb.ppu.frameCount;
  let ticks = 0;
  for (; gb.ppu.frameCount === frame; ticks++) gb.tick();
  return ticks;
}

describe('Game Boy Color double speed', () => {
  it('switches speed on STOP once KEY1 is armed, pausing 2050 M-cycles with DIV held', () => {
    const gb = new GameBoy(switchSpeed, { model: 'cgb' });
    expect(gb.read(IO.KEY1)).toBe(0x7e);
    // Two M-cycles at normal speed to fetch STOP, then the pause at double speed.
    expect(runToSwitch(gb)).toBe(8 + 2050 * 2);
    expect([gb.read(IO.KEY1), gb.cpu.stopped, gb.timer.counter]).toEqual([0xfe, false, 0]);
    gb.step();
    expect(gb.timer.counter).toBe(12); // JR: 3 M-cycles

    // Fetched at double speed, paused at normal speed.
    expect(runToSwitch(gb)).toBe(2 + 2 + 2050 * 4);
    expect(gb.read(IO.KEY1)).toBe(0x7e);
  });

  it('gives the CPU and timer twice the M-cycles per frame, but not the PPU or APU', () => {
    const gb = new GameBoy(switchSpeed, { model: 'cgb' });
    expect(mCyclesPerFrame(gb)).toBe(CYCLES_PER_FRAME / 4);
    runToSwitch(gb);
    expect(mCyclesPerFrame(gb)).toBe(CYCLES_PER_FRAME / 2);

    // DIV counts CPU M-cycles, so it runs twice as fast in real time.
    const cycles = gb.cycles;
    const counter = gb.timer.counter;
    for (let i = 0; i < 1000; i++) gb.tick();
    expect([gb.cycles - cycles, (gb.timer.counter - counter) & 0xffff]).toEqual([2000, 4000]);

    // The APU's frame sequencer moves to DIV bit 5 and stays at 512 Hz.
    const sequencer = vi.spyOn(gb.apu, 'clockFrameSequencer');
    const until = gb.cycles + CLOCK_HZ / 8;
    while (gb.cycles < until) gb.tick();
    expect(sequencer).toHaveBeenCalledTimes(64);
  });

  it('stalls the CPU 16 M-cycles a VRAM DMA block in double speed', () => {
    const gb = new GameBoy(switchSpeed, { model: 'cgb' });
    runToSwitch(gb);
    gb.write(IO.LCDC, 0x00);
    gb.write(IO.HDMA1, 0xc0);
    gb.write(IO.HDMA5, 0x00);
    const before = gb.cycles;
    gb.tick();
    expect(gb.cycles - before).toBe(2 + 16 * 2);
  });

  it('keeps the speed in save states', () => {
    const a = new GameBoy(switchSpeed, { model: 'cgb' });
    runToSwitch(a);
    a.write(IO.KEY1, 0x01);
    const b = new GameBoy(switchSpeed, { model: 'cgb' });
    b.deserialize(a.serialize(T0), T0);
    expect(b.read(IO.KEY1)).toBe(0xff);
    for (let i = 0; i < 3; i++) {
      a.runFrame();
      b.runFrame();
    }
    expect(b.serialize(T0)).toEqual(a.serialize(T0));
  });

  it('is absent on a DMG, where STOP stops', () => {
    const gb = new GameBoy(switchSpeed);
    expect(gb.read(IO.KEY1)).toBe(0xff);
    runToSwitch(gb);
    expect([gb.read(IO.KEY1), gb.cpu.stopped]).toEqual([0xff, true]);
    expect(mCyclesPerFrame(gb)).toBe(CYCLES_PER_FRAME / 4);
  });
});
