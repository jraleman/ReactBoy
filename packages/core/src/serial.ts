import { Interrupt, type Interrupts } from './interrupts';
import type { StateReader, StateWriter, Stateful } from './state';

/**
 * Bit of the timer's internal counter that the internal 8192 Hz serial clock is divided
 * from. A bit shifts on each falling edge, so a transfer's timing depends on the counter's
 * phase rather than on when SC was written. Measured against Mooneye's boot_sclk_align, the
 * shift lands on the M-cycle before the counter, as the timer reports it, reaches the edge.
 */
const CLOCK_BIT = 1 << 8;

/**
 * SB/SC with no link partner attached: bytes shift out and 0xFF shifts in. Sent bytes are
 * reported through {@link onByte}, which is how Blargg's test ROMs report results headlessly.
 */
export class Serial implements Stateful {
  data = 0;
  control = 0x7e;
  onByte: ((byte: number) => void) | null = null;
  /** Bits still to shift in the current transfer. */
  private bitsLeft = 0;

  constructor(
    private readonly interrupts: Interrupts,
    /** The timer's internal counter, already advanced for the current M-cycle. */
    private readonly counter: () => number,
  ) {}

  readControl(): number {
    return this.control | 0x7e;
  }

  writeControl(value: number): void {
    this.control = value & 0x81;
    // Only transfers on the internal clock progress without a partner.
    if ((value & 0x81) === 0x81) {
      this.onByte?.(this.data);
      this.bitsLeft = 8;
    }
  }

  tick(): void {
    if (this.bitsLeft === 0) return;
    const counter = this.counter();
    if ((counter & CLOCK_BIT) === 0 || ((counter + 4) & CLOCK_BIT) !== 0) return;
    if (--this.bitsLeft === 0) {
      this.data = 0xff;
      this.control &= 0x7f;
      this.interrupts.request(Interrupt.Serial);
    }
  }

  writeState(w: StateWriter): void {
    w.u8(this.data);
    w.u8(this.control);
    w.u8(this.bitsLeft);
  }

  readState(r: StateReader): void {
    this.data = r.u8();
    this.control = r.u8();
    this.bitsLeft = r.u8();
  }
}
