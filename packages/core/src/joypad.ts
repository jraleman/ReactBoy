import { Interrupt, type Interrupts } from './interrupts';

export const Button = {
  Right: 0,
  Left: 1,
  Up: 2,
  Down: 3,
  A: 4,
  B: 5,
  Select: 6,
  Start: 7,
} as const;

export type ButtonId = (typeof Button)[keyof typeof Button];

/** P1/JOYP (0xFF00): a 2x4 button matrix selected by bits 4 (d-pad) and 5 (buttons). */
export class Joypad {
  /** Bit set = button held, laid out as in {@link Button}. */
  private held = 0;
  private select = 0x30;

  constructor(private readonly interrupts: Interrupts) {}

  read(): number {
    let lines = 0x0f;
    if ((this.select & 0x10) === 0) lines &= ~this.held & 0x0f;
    if ((this.select & 0x20) === 0) lines &= ~(this.held >> 4) & 0x0f;
    return 0xc0 | this.select | lines;
  }

  write(value: number): void {
    const before = this.read();
    this.select = value & 0x30;
    this.raiseOnFallingEdge(before);
  }

  setButton(button: ButtonId, pressed: boolean): void {
    const before = this.read();
    if (pressed) this.held |= 1 << button;
    else this.held &= ~(1 << button);
    this.raiseOnFallingEdge(before);
  }

  anyPressed(): boolean {
    return this.held !== 0;
  }

  private raiseOnFallingEdge(before: number): void {
    if (before & ~this.read() & 0x0f) this.interrupts.request(Interrupt.Joypad);
  }
}
