import { describe, expect, it } from 'vitest';
import { Interrupts } from '../src/interrupts';
import { Serial } from '../src/serial';

describe('Serial', () => {
  it('times transfers by the divider clock, not by when SC was written', () => {
    const finishAt = (start: number) => {
      const interrupts = new Interrupts();
      interrupts.flags = 0;
      let counter = start;
      const serial = new Serial(interrupts, () => counter);
      serial.writeControl(0x81);
      while ((interrupts.flags & 0x08) === 0) {
        counter = (counter + 4) & 0xffff;
        serial.tick();
      }
      return [counter, serial.data, serial.readControl() & 0x80];
    };
    // Eight 512-cycle bits, each shifting just before bit 8 of the counter falls.
    expect(finishAt(0x0f0)).toEqual([0xffc, 0xff, 0]);
    expect(finishAt(0x180)).toEqual([0xffc, 0xff, 0]);
  });
});

describe('Serial over a link cable', () => {
  /** Two serial ports joined by a cable that delivers instantly. */
  function cable() {
    const sides = [0, 1].map(() => {
      const interrupts = new Interrupts();
      interrupts.flags = 0;
      return { interrupts, serial: new Serial(interrupts, () => 0) };
    });
    const [a, b] = sides as [(typeof sides)[0], (typeof sides)[0]];
    a.serial.link = { send: (v) => b.serial.receive(v), reply: (v) => b.serial.receiveReply(v) };
    b.serial.link = { send: (v) => a.serial.receive(v), reply: (v) => a.serial.receiveReply(v) };
    const done = (side: typeof a) => (side.interrupts.flags & 0x08) !== 0;
    return { a, b, done };
  }

  it('swaps bytes between the clocking side and a waiting partner', () => {
    const { a, b, done } = cable();
    b.serial.data = 0x99;
    b.serial.writeControl(0x80); // wait on the partner's clock
    a.serial.data = 0x42;
    a.serial.writeControl(0x81);
    expect([a.serial.data, b.serial.data]).toEqual([0x99, 0x42]);
    expect([done(a), done(b), a.serial.readControl() & 0x80]).toEqual([true, true, 0]);
  });

  it('holds a byte until the partner gets ready', () => {
    const { a, b, done } = cable();
    a.serial.data = 0x42;
    a.serial.writeControl(0x81);
    expect(done(a)).toBe(false);
    b.serial.data = 0x07;
    b.serial.writeControl(0x80);
    expect([a.serial.data, b.serial.data, done(a), done(b)]).toEqual([0x07, 0x42, true, true]);
  });

  it('gives up with $FF when the partner never answers', () => {
    const { a, done } = cable();
    a.serial.link = { send: () => {}, reply: () => {} };
    a.serial.writeControl(0x81);
    let cycles = 0;
    while (!done(a)) {
      a.serial.tick();
      cycles += 4;
    }
    expect(a.serial.data).toBe(0xff);
    expect(cycles).toBeGreaterThan(70224 * 4);
  });
});
