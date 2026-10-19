import { describe, expect, it } from 'vitest';
import { Interrupts } from '../src/interrupts';
import { Timer } from '../src/timer';

const setup = (tac: number) => {
  const interrupts = new Interrupts();
  interrupts.flags = 0;
  const timer = new Timer(interrupts);
  timer.counter = 0;
  timer.writeTac(tac);
  return { timer, interrupts };
};

const mcycles = (timer: Timer, n: number) => {
  for (let i = 0; i < n; i++) timer.tick();
};

describe('Timer', () => {
  it('increments TIMA every 16 T-cycles at 262144 Hz', () => {
    const { timer } = setup(0x05);
    mcycles(timer, 4 * 10);
    expect(timer.tima).toBe(10);
  });

  it('reloads TMA and requests an interrupt one M-cycle after overflow', () => {
    const { timer, interrupts } = setup(0x05);
    timer.tima = 0xff;
    timer.tma = 0x80;
    mcycles(timer, 4);
    expect(timer.tima).toBe(0);
    expect(interrupts.flags).toBe(0);
    mcycles(timer, 1);
    expect(timer.tima).toBe(0x80);
    expect(interrupts.flags).toBe(0x04);
  });

  it('cancels the reload when TIMA is written during the overflow cycle', () => {
    const { timer, interrupts } = setup(0x05);
    timer.tima = 0xff;
    mcycles(timer, 4);
    timer.writeTima(0x12);
    mcycles(timer, 1);
    expect(timer.tima).toBe(0x12);
    expect(interrupts.flags).toBe(0);
  });

  it('bumps TIMA when resetting DIV causes a falling edge', () => {
    const { timer } = setup(0x05);
    mcycles(timer, 2); // counter = 8: bit 3 is high
    timer.writeDiv();
    expect(timer.tima).toBe(1);
    expect(timer.readDiv()).toBe(0);
  });
});
