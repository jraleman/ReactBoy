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
