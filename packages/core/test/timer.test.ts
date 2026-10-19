import { describe, expect, it } from 'vitest';
import { Interrupts } from '../src/interrupts';
import { Timer } from '../src/timer';

const setup = (tac: number) => {
  const interrupts = new Interrupts();
  interrupts.flags = 0;
  const timer = new Timer(interrupts);
  // Set directly: a TAC write would look for an edge in the M-cycle leading up to counter 0.
  timer.counter = 0;
  timer.tac = tac;
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

  it('counts an edge that falls in the M-cycle the timer is enabled', () => {
    // TAC writes land before the counter advances in their M-cycle (Mooneye's rapid_toggle).
    const { timer } = setup(0x00); // stopped, 4096 Hz selected
    timer.counter = 0x3fc; // bit 9 high
    timer.tick(); // bit 9 falls while the timer is still stopped...
    timer.writeTac(0x04); // ...but the write lands first
    expect(timer.tima).toBe(1);
    mcycles(timer, 1);
    timer.writeTac(0x00);
    timer.writeTac(0x04); // one M-cycle later there is no edge left to count
    expect(timer.tima).toBe(1);
  });

  it('bumps TIMA when resetting DIV causes a falling edge', () => {
    const { timer } = setup(0x05);
    mcycles(timer, 2); // counter = 8: bit 3 is high
    timer.writeDiv();
    expect(timer.tima).toBe(1);
    expect(timer.readDiv()).toBe(0);
  });
});
