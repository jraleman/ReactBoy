import { Interrupt, type Interrupts } from './interrupts';
import type { StateReader, StateWriter, Stateful } from './state';

/** T-cycles to shift out one byte with the internal 8192 Hz clock. */
const TRANSFER_CYCLES = 8 * 512;

/**
 * SB/SC with no link partner attached: bytes shift out and 0xFF shifts in. Sent bytes are
 * reported through {@link onByte}, which is how Blargg's test ROMs report results headlessly.
 */
export class Serial implements Stateful {
  data = 0;
  control = 0x7e;
  onByte: ((byte: number) => void) | null = null;
  private remaining = 0;

  constructor(private readonly interrupts: Interrupts) {}

  readControl(): number {
    return this.control | 0x7e;
  }

  writeControl(value: number): void {
    this.control = value & 0x81;
    // Only transfers on the internal clock progress without a partner.
    if ((value & 0x81) === 0x81) {
      this.onByte?.(this.data);
      this.remaining = TRANSFER_CYCLES;
    }
  }

  tick(): void {
    if (this.remaining === 0) return;
    this.remaining -= 4;
    if (this.remaining === 0) {
      this.data = 0xff;
      this.control &= 0x7f;
      this.interrupts.request(Interrupt.Serial);
    }
  }

  writeState(w: StateWriter): void {
    w.u8(this.data);
    w.u8(this.control);
    w.u16(this.remaining);
  }

  readState(r: StateReader): void {
    this.data = r.u8();
    this.control = r.u8();
    this.remaining = r.u16();
  }
}
