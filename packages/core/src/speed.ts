import type { StateReader, StateWriter, Stateful } from './state';
import type { Timer } from './timer';

/**
 * KEY1 on a Game Boy Color: the CPU's speed, and whether the next STOP switches it. Double
 * speed runs the CPU, timer, serial port and OAM DMA twice as fast; the PPU, APU and VRAM
 * DMA keep their timing, so they get half as much done per CPU M-cycle.
 */
export class Speed implements Stateful {
  double = false;
  /** Bit 0 of KEY1: STOP switches speed rather than stopping. */
  armed = false;

  constructor(private readonly timer: Timer) {}

  /** Real time per CPU M-cycle, in normal-speed T-cycles. */
  get cycleLength(): number {
    return this.double ? 2 : 4;
  }

  read(): number {
    return 0x7e | (this.double ? 0x80 : 0) | (this.armed ? 1 : 0);
  }

  write(value: number): void {
    this.armed = (value & 1) !== 0;
  }

  /** STOP was executed while {@link armed}. */
  toggle(): void {
    this.armed = false;
    this.set(!this.double);
  }

  private set(double: boolean): void {
    this.double = double;
    this.timer.setDoubleSpeed(double);
  }

  writeState(w: StateWriter): void {
    w.bool(this.double);
    w.bool(this.armed);
  }

  readState(r: StateReader): void {
    this.set(r.bool());
    this.armed = r.bool();
  }
}
