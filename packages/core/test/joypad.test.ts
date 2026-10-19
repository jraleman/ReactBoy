import { describe, expect, it } from 'vitest';
import { Button } from '../src';
import { Interrupts } from '../src/interrupts';
import { Joypad } from '../src/joypad';

describe('Joypad', () => {
  it('reports pressed buttons as 0 on the selected line and raises an interrupt', () => {
    const interrupts = new Interrupts();
    interrupts.flags = 0;
    const joypad = new Joypad(interrupts);
    joypad.write(0x20); // select d-pad
    joypad.setButton(Button.Left, true);
    joypad.setButton(Button.A, true); // not selected: no effect on the d-pad read
    expect(joypad.read() & 0x0f).toBe(0b1101);
    expect(interrupts.flags).toBe(0x10);
    joypad.write(0x10); // select buttons
    expect(joypad.read() & 0x0f).toBe(0b1110);
  });
});
