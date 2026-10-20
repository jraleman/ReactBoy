import { CYCLES_PER_FRAME } from './constants';
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
 * How long a transfer on this side's clock waits for the partner's byte before giving up
 * with 0xFF, as if the cable were unplugged. Generous, because the partner is another
 * emulator that may be a few frames behind.
 */
const LINK_TIMEOUT = 8 * CYCLES_PER_FRAME;

/**
 * The other end of a link cable. Transfers are exchanged a byte at a time rather than bit
 * by bit, since the two machines don't run in lockstep.
 */
export interface SerialLink {
  /** This side started a transfer on its own clock: deliver `byte` to the partner. */
  send(byte: number): void;
  /** This side took part in the partner's transfer and answers with `byte`. */
  reply(byte: number): void;
}

/**
 * SB/SC. With no {@link link} attached, bytes shift out and 0xFF shifts in. Sent bytes are
 * reported through {@link onByte}, which is how Blargg's test ROMs report results headlessly.
 */
export class Serial implements Stateful {
  data = 0;
  control = 0x7e;
  onByte: ((byte: number) => void) | null = null;
  /** Transfers started, for {@link GameBoy.takeActivity}; not part of the saved state. */
  transfers = 0;
  /** A link cable to another machine. Like the cable's traffic, not part of the saved state. */
  link: SerialLink | null = null;
  /** Bits still to shift in the current transfer. */
  private bitsLeft = 0;
  /** T-cycles left to wait for the partner's answer to a transfer on this side's clock. */
  private waitCycles = 0;
  /** The partner's byte, when it arrived before this side was ready to take part. */
  private incoming: number | null = null;

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
    if (value & 0x80) this.transfers++;
    if (this.control === 0x81) {
      this.onByte?.(this.data);
      if (this.incoming !== null) {
        // The partner is already waiting on its own transfer: swap with that instead.
        const byte = this.incoming;
        this.incoming = null;
        this.answer(byte);
      } else if (this.link) {
        this.waitCycles = LINK_TIMEOUT;
        this.link.send(this.data);
      } else {
        // Without a partner, only transfers on the internal clock progress.
        this.bitsLeft = 8;
      }
    } else if (this.control === 0x80 && this.incoming !== null) {
      const byte = this.incoming;
      this.incoming = null;
      this.answer(byte);
    }
  }

  /**
   * The partner started a transfer and sent `byte`. Taken at once if this side is waiting on
   * the partner's clock (or started its own transfer at the same moment: both then swap
   * bytes), otherwise kept until it is.
   */
  receive(byte: number): void {
    if (this.control === 0x80 || this.waitCycles > 0) this.answer(byte);
    else this.incoming = byte;
  }

  /** The partner answered this side's transfer with `byte`. Late answers are dropped. */
  receiveReply(byte: number): void {
    if (this.waitCycles === 0) return;
    this.waitCycles = 0;
    this.finish(byte);
  }

  private answer(byte: number): void {
    this.waitCycles = 0;
    this.link?.reply(this.data);
    this.finish(byte);
  }

  private finish(byte: number): void {
    this.data = byte;
    this.control &= 0x7f;
    this.interrupts.request(Interrupt.Serial);
  }

  tick(): void {
    if (this.waitCycles > 0) {
      this.waitCycles -= 4;
      if (this.waitCycles <= 0) {
        this.waitCycles = 0;
        this.finish(0xff);
      }
      return;
    }
    if (this.bitsLeft === 0) return;
    const counter = this.counter();
    if ((counter & CLOCK_BIT) === 0 || ((counter + 4) & CLOCK_BIT) !== 0) return;
    if (--this.bitsLeft === 0) this.finish(0xff);
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
