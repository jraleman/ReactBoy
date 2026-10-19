import type { Interrupts } from '../interrupts';
import { CB_OPCODES } from './cb-opcodes';
import { OPCODES } from './opcodes';
import { A, B, C, D, E, F, FLAG_C, FLAG_H, FLAG_N, FLAG_Z, H, HL_INDIRECT, L } from './registers';

/** What the CPU sees of the rest of the machine. */
export interface Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
  /** Advances every other component by one M-cycle (4 T-cycles). */
  tick(): void;
  /** STOP was executed. */
  stop(): void;
}

/**
 * Sharp SM83. Each memory access and internal delay calls {@link Bus.tick}, so the rest of
 * the system advances in lockstep, one M-cycle at a time, and instruction timing falls out
 * of the access pattern rather than a cycle table.
 *
 * Methods below `step()` are the micro-operations the opcode tables are built from.
 */
export class Cpu {
  /** B, C, D, E, H, L, F, A — see ./registers. */
  readonly r = new Uint8Array(8);
  sp = 0;
  pc = 0;
  ime = false;
  halted = false;
  stopped = false;
  /** Set by an illegal opcode: the real CPU hangs until power-off. */
  locked = false;
  /** EI takes effect after the following instruction. */
  private imeScheduled = false;
  /** HALT with IME=0 and an interrupt pending fails to advance PC past the next opcode. */
  private haltBug = false;

  constructor(
    private readonly bus: Bus,
    private readonly interrupts: Interrupts,
  ) {}

  /** Registers as the DMG boot ROM leaves them at 0x0100. */
  reset(headerChecksum: number): void {
    this.af = headerChecksum === 0 ? 0x0180 : 0x01b0;
    this.bc = 0x0013;
    this.de = 0x00d8;
    this.hl = 0x014d;
    this.sp = 0xfffe;
    this.pc = 0x0100;
    this.ime = this.imeScheduled = this.halted = this.stopped = this.locked = this.haltBug = false;
  }

  /** Runs one instruction, interrupt dispatch, or idle M-cycle while halted. */
  step(): void {
    if (this.locked) {
      this.bus.tick();
      return;
    }
    const pending = this.interrupts.pending();
    if (this.stopped) {
      if ((this.interrupts.flags & 0x10) === 0) {
        this.bus.tick();
        return;
      }
      this.stopped = false;
    }
    if (this.halted) {
      if (pending === 0) {
        this.bus.tick();
        return;
      }
      this.halted = false;
    }
    if (this.ime && pending !== 0) {
      this.dispatchInterrupt();
      return;
    }
    if (this.imeScheduled) {
      this.imeScheduled = false;
      this.ime = true;
    }
    OPCODES[this.fetch8()]!.execute(this);
  }

  private dispatchInterrupt(): void {
    this.ime = false;
    this.internal();
    this.internal();
    this.sp = (this.sp - 1) & 0xffff;
    this.write8(this.sp, this.pc >> 8);
    // The vector is picked after the high byte is pushed, which may itself have changed IE.
    const pending = this.interrupts.pending();
    this.sp = (this.sp - 1) & 0xffff;
    this.write8(this.sp, this.pc & 0xff);
    if (pending === 0) {
      this.pc = 0x0000;
    } else {
      const bit = pending & -pending;
      this.interrupts.flags &= ~bit;
      this.pc = 0x40 + 8 * (31 - Math.clz32(bit));
    }
    this.internal();
  }

  // --- Register pairs -------------------------------------------------------------------

  get af(): number {
    return (this.r[A]! << 8) | this.r[F]!;
  }
  set af(v: number) {
    this.r[A] = v >> 8;
    this.r[F] = v & 0xf0;
  }
  get bc(): number {
    return (this.r[B]! << 8) | this.r[C]!;
  }
  set bc(v: number) {
    this.r[B] = v >> 8;
    this.r[C] = v;
  }
  get de(): number {
    return (this.r[D]! << 8) | this.r[E]!;
  }
  set de(v: number) {
    this.r[D] = v >> 8;
    this.r[E] = v;
  }
  get hl(): number {
    return (this.r[H]! << 8) | this.r[L]!;
  }
  set hl(v: number) {
    this.r[H] = v >> 8;
    this.r[L] = v;
  }

  /** BC, DE, HL, SP by opcode encoding. */
  getRp(i: number): number {
    return i === 0 ? this.bc : i === 1 ? this.de : i === 2 ? this.hl : this.sp;
  }
  setRp(i: number, v: number): void {
    if (i === 0) this.bc = v;
    else if (i === 1) this.de = v;
    else if (i === 2) this.hl = v;
    else this.sp = v & 0xffff;
  }
  /** BC, DE, HL, AF by opcode encoding (PUSH/POP). */
  getRp2(i: number): number {
    return i === 3 ? this.af : this.getRp(i);
  }
  setRp2(i: number, v: number): void {
    if (i === 3) this.af = v;
    else this.setRp(i, v);
  }

  /** B, C, D, E, H, L, (HL), A by opcode encoding. */
  getR8(i: number): number {
    return i === HL_INDIRECT ? this.read8(this.hl) : this.r[i]!;
  }
  setR8(i: number, v: number): void {
    if (i === HL_INDIRECT) this.write8(this.hl, v & 0xff);
    else this.r[i] = v;
  }

  /** NZ, Z, NC, C by opcode encoding. */
  condition(cc: number): boolean {
    const f = this.r[F]!;
    switch (cc) {
      case 0:
        return (f & FLAG_Z) === 0;
      case 1:
        return (f & FLAG_Z) !== 0;
      case 2:
        return (f & FLAG_C) === 0;
      default:
        return (f & FLAG_C) !== 0;
    }
  }

  carry(): number {
    return (this.r[F]! & FLAG_C) >> 4;
  }

  // --- Bus micro-ops (one M-cycle each) ----------------------------------------------------

  read8(addr: number): number {
    this.bus.tick();
    return this.bus.read(addr);
  }

  write8(addr: number, value: number): void {
    this.bus.tick();
    this.bus.write(addr, value);
  }

  internal(): void {
    this.bus.tick();
  }

  fetch8(): number {
    const v = this.read8(this.pc);
    if (this.haltBug) this.haltBug = false;
    else this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  fetch16(): number {
    const lo = this.fetch8();
    return lo | (this.fetch8() << 8);
  }

  /** Signed 8-bit immediate. */
  fetchOffset(): number {
    return (this.fetch8() << 24) >> 24;
  }

  push16(v: number): void {
    this.internal();
    this.sp = (this.sp - 1) & 0xffff;
    this.write8(this.sp, v >> 8);
    this.sp = (this.sp - 1) & 0xffff;
    this.write8(this.sp, v & 0xff);
  }

  pop16(): number {
    const lo = this.read8(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    const hi = this.read8(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    return (hi << 8) | lo;
  }

  // --- Control ----------------------------------------------------------------------------

  halt(): void {
    if (!this.ime && this.interrupts.pending() !== 0) this.haltBug = true;
    else this.halted = true;
  }

  stop(): void {
    this.fetch8();
    this.stopped = true;
    this.bus.stop();
  }

  enableInterrupts(): void {
    this.imeScheduled = true;
  }

  disableInterrupts(): void {
    this.ime = false;
    this.imeScheduled = false;
  }

  executeCb(): void {
    CB_OPCODES[this.fetch8()]!.execute(this);
  }

  // --- 8-bit ALU (operates on A) ----------------------------------------------------------

  add(v: number, carry: number): void {
    const a = this.r[A]!;
    const result = a + v + carry;
    this.r[A] = result;
    this.r[F] =
      ((result & 0xff) === 0 ? FLAG_Z : 0) |
      ((a & 0x0f) + (v & 0x0f) + carry > 0x0f ? FLAG_H : 0) |
      (result > 0xff ? FLAG_C : 0);
  }

  sub(v: number, carry: number, store: boolean): void {
    const a = this.r[A]!;
    const result = a - v - carry;
    if (store) this.r[A] = result;
    this.r[F] =
      ((result & 0xff) === 0 ? FLAG_Z : 0) |
      FLAG_N |
      ((a & 0x0f) - (v & 0x0f) - carry < 0 ? FLAG_H : 0) |
      (result < 0 ? FLAG_C : 0);
  }

  and(v: number): void {
    const result = this.r[A]! & v;
    this.r[A] = result;
    this.r[F] = (result === 0 ? FLAG_Z : 0) | FLAG_H;
  }

  xor(v: number): void {
    const result = this.r[A]! ^ v;
    this.r[A] = result;
    this.r[F] = result === 0 ? FLAG_Z : 0;
  }

  or(v: number): void {
    const result = this.r[A]! | v;
    this.r[A] = result;
    this.r[F] = result === 0 ? FLAG_Z : 0;
  }

  inc8(v: number): number {
    const result = (v + 1) & 0xff;
    this.r[F] =
      (this.r[F]! & FLAG_C) | (result === 0 ? FLAG_Z : 0) | ((v & 0x0f) === 0x0f ? FLAG_H : 0);
    return result;
  }

  dec8(v: number): number {
    const result = (v - 1) & 0xff;
    this.r[F] =
      (this.r[F]! & FLAG_C) |
      (result === 0 ? FLAG_Z : 0) |
      FLAG_N |
      ((v & 0x0f) === 0 ? FLAG_H : 0);
    return result;
  }

  daa(): void {
    let a = this.r[A]!;
    const f = this.r[F]!;
    let carry = f & FLAG_C;
    if (f & FLAG_N) {
      if (carry) a -= 0x60;
      if (f & FLAG_H) a -= 0x06;
    } else {
      if (carry || a > 0x99) {
        a += 0x60;
        carry = FLAG_C;
      }
      if (f & FLAG_H || (a & 0x0f) > 0x09) a += 0x06;
    }
    this.r[A] = a;
    this.r[F] = ((a & 0xff) === 0 ? FLAG_Z : 0) | (f & FLAG_N) | carry;
  }

  // --- 16-bit ALU -------------------------------------------------------------------------

  addHl(v: number): void {
    const hl = this.hl;
    const result = hl + v;
    this.r[F] =
      (this.r[F]! & FLAG_Z) |
      ((hl & 0x0fff) + (v & 0x0fff) > 0x0fff ? FLAG_H : 0) |
      (result > 0xffff ? FLAG_C : 0);
    this.hl = result & 0xffff;
    this.internal();
  }

  /** SP + signed offset, with H/C computed on the low byte as the hardware does. */
  addSpOffset(e: number): number {
    const sp = this.sp;
    this.r[F] =
      ((sp & 0x0f) + (e & 0x0f) > 0x0f ? FLAG_H : 0) |
      ((sp & 0xff) + (e & 0xff) > 0xff ? FLAG_C : 0);
    return (sp + e) & 0xffff;
  }

  // --- Rotates, shifts and bit ops (CB prefix; RLCA etc. reuse these) --------------------

  private shiftResult(result: number, carryOut: number): number {
    result &= 0xff;
    this.r[F] = (result === 0 ? FLAG_Z : 0) | (carryOut ? FLAG_C : 0);
    return result;
  }

  rlc(v: number): number {
    return this.shiftResult((v << 1) | (v >> 7), v & 0x80);
  }
  rrc(v: number): number {
    return this.shiftResult((v >> 1) | (v << 7), v & 0x01);
  }
  rl(v: number): number {
    return this.shiftResult((v << 1) | this.carry(), v & 0x80);
  }
  rr(v: number): number {
    return this.shiftResult((v >> 1) | (this.carry() << 7), v & 0x01);
  }
  sla(v: number): number {
    return this.shiftResult(v << 1, v & 0x80);
  }
  sra(v: number): number {
    return this.shiftResult((v >> 1) | (v & 0x80), v & 0x01);
  }
  swap(v: number): number {
    return this.shiftResult(((v & 0x0f) << 4) | (v >> 4), 0);
  }
  srl(v: number): number {
    return this.shiftResult(v >> 1, v & 0x01);
  }

  bit(n: number, v: number): void {
    this.r[F] = (this.r[F]! & FLAG_C) | FLAG_H | ((v & (1 << n)) === 0 ? FLAG_Z : 0);
  }
}
