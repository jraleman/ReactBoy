import { CYCLES_PER_FRAME } from './constants';
import { CB_OPCODES } from './cpu/cb-opcodes';
import { OPCODES } from './cpu/opcodes';
import type { GameBoy } from './gameboy';

/**
 * Stops before the instruction at `addr`. In the switchable ROM area (0x4000-0x7FFF) a
 * `bank` limits it to that bank being mapped; elsewhere, and with no bank, any will do.
 */
export interface Breakpoint {
  addr: number;
  bank?: number | null;
}

/** Stops after an instruction that reads and/or writes `addr`. */
export interface Watchpoint {
  addr: number;
  read: boolean;
  write: boolean;
}

/** Why the {@link Debugger} stopped the machine. `pc` is where it stopped. */
export type BreakReason =
  /** About to execute the instruction at a breakpoint. */
  | { type: 'breakpoint'; pc: number }
  /** The instruction at `at` read `value` from, or wrote it to, the watched address `addr`. */
  | {
      type: 'watchpoint';
      pc: number;
      at: number;
      access: 'read' | 'write';
      addr: number;
      value: number;
    }
  /** A step over or step out finished. */
  | { type: 'step'; pc: number };

/** Into: one instruction. Over: past a CALL/RST. Out: until the current routine returns. */
export type StepMode = 'into' | 'over' | 'out';

export type CpuRunState = 'running' | 'halted' | 'stopped' | 'locked';

/** The machine as a debugger shows it. */
export interface DebugSnapshot {
  af: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  pc: number;
  ime: boolean;
  cpu: CpuRunState;
  /** The ROM bank mapped at 0x4000-0x7FFF (wrapped to the banks the ROM has). */
  romBank: number;
  cycles: number;
  frame: number;
  /** All 64 KiB as the CPU sees it, read without side effects (see {@link GameBoy.peek}). */
  memory: Uint8Array;
}

const CALLS = new Set([0xcd, 0xc4, 0xcc, 0xd4, 0xdc]);
const RETURNS = new Set([0xc9, 0xd9, 0xc0, 0xc8, 0xd0, 0xd8]);
/** RST n: 11xxx111. */
const isRst = (opcode: number) => (opcode & 0xc7) === 0xc7;

/** Bits of the breakpoint table: any bank, or only the banks listed for the address. */
const ANY_BANK = 1;
const SOME_BANKS = 2;
/** Bits of the watchpoint table. */
const WATCH_WRITE = 1;
const WATCH_READ = 2;
const BANKED = { start: 0x4000, end: 0x8000 };

/** The bank mapped at 0x4000-0x7FFF, wrapped to the banks the ROM has. */
function mappedBank(gb: GameBoy): number {
  const banks = Math.max(2, gb.header.romSize >> 14);
  return gb.mbc.romBank % banks;
}

/** The machine as a debugger shows it; needs no {@link Debugger} attached. */
export function snapshot(gb: GameBoy): DebugSnapshot {
  const { cpu } = gb;
  const memory = new Uint8Array(0x10000);
  for (let addr = 0; addr < memory.length; addr++) memory[addr] = gb.peek(addr);
  return {
    af: cpu.af,
    bc: cpu.bc,
    de: cpu.de,
    hl: cpu.hl,
    sp: cpu.sp,
    pc: cpu.pc,
    ime: cpu.ime,
    cpu: cpu.locked ? 'locked' : cpu.stopped ? 'stopped' : cpu.halted ? 'halted' : 'running',
    romBank: mappedBank(gb),
    cycles: gb.cycles,
    frame: gb.ppu.frameCount,
    memory,
  };
}

/**
 * Breakpoints, watchpoints and stepping for a {@link GameBoy}. Watchpoints, and breakpoints
 * without a bank, match a CPU address in whatever bank is mapped there.
 *
 * Use {@link runFrame} in place of `GameBoy.runFrame` while it is attached; the plain
 * machine never pays for these checks.
 */
export class Debugger {
  private readonly breakpoints = new Uint8Array(0x10000);
  /** ROM banks of the breakpoints limited to one, by address. */
  private readonly breakpointBanks = new Map<number, Set<number>>();
  private readonly watchpoints = new Uint8Array(0x10000);
  private hit: BreakReason | null = null;
  /** Address of the instruction being executed, for watchpoint reports. */
  private current = 0;
  /** End of its opcode and operands: a read watchpoint ignores the fetch of those bytes. */
  private currentEnd = 0;
  /**
   * Set when stopped: the player has seen the machine at this PC, so continuing runs the
   * instruction there instead of stopping at its breakpoint again.
   */
  private resuming = false;
  private target: { kind: 'over'; pc: number; sp: number } | { kind: 'out'; sp: number } | null =
    null;

  constructor(private readonly gb: GameBoy) {}

  /** A step over or step out is still running. */
  get stepping(): boolean {
    return this.target !== null;
  }

  setBreakpoints(points: Iterable<Breakpoint>): void {
    this.breakpoints.fill(0);
    this.breakpointBanks.clear();
    for (const { addr: a, bank } of points) {
      const addr = a & 0xffff;
      if (bank === undefined || bank === null || addr < BANKED.start || addr >= BANKED.end) {
        this.breakpoints[addr]! |= ANY_BANK;
        continue;
      }
      this.breakpoints[addr]! |= SOME_BANKS;
      const banks = this.breakpointBanks.get(addr) ?? new Set();
      this.breakpointBanks.set(addr, banks.add(bank));
    }
  }

  setWatchpoints(points: Iterable<Watchpoint>): void {
    this.watchpoints.fill(0);
    let reads = false;
    let writes = false;
    for (const { addr, read, write } of points) {
      this.watchpoints[addr & 0xffff]! |= (read ? WATCH_READ : 0) | (write ? WATCH_WRITE : 0);
      reads ||= read;
      writes ||= write;
    }
    this.gb.onWrite = writes ? this.onWrite : null;
    this.gb.onRead = reads ? this.onRead : null;
  }

  /** Abandons a step over or step out. */
  cancelStep(): void {
    this.target = null;
  }

  /** Releases the machine's memory hooks. */
  detach(): void {
    if (this.gb.onWrite === this.onWrite) this.gb.onWrite = null;
    if (this.gb.onRead === this.onRead) this.gb.onRead = null;
  }

  /**
   * Like `GameBoy.runFrame`, but stops before an instruction at a breakpoint, after one
   * that hits a watchpoint, or where a step over/out finishes.
   * @returns why it stopped, or null when the frame completed
   */
  runFrame(): BreakReason | null {
    const { gb } = this;
    const { cpu } = gb;
    const frame = gb.ppu.frameCount;
    const start = gb.cycles;
    while (gb.ppu.frameCount === frame && gb.cycles - start < CYCLES_PER_FRAME) {
      const pc = cpu.pc;
      const executing = this.executing();
      if (executing) {
        if (this.resuming) this.resuming = false;
        else if (this.breakpoints[pc] && this.breaksAt(pc)) {
          return this.stop({ type: 'breakpoint', pc });
        }
      }
      const target = this.target;
      const returning = executing && target?.kind === 'out' && RETURNS.has(gb.peek(pc));
      this.begin(pc);
      cpu.step();
      if (this.hit) return this.stop({ ...this.hit, pc: cpu.pc });
      if (target === null) continue;
      // Over: back at the next instruction with the CALL's frame popped (recursion re-enters
      // the same address deeper in the stack). Out: a return popped past the routine's frame.
      const done =
        target.kind === 'over'
          ? cpu.pc === target.pc && cpu.sp >= target.sp
          : returning && cpu.sp > target.sp;
      if (done) return this.stop({ type: 'step', pc: cpu.pc });
    }
    return null;
  }

  /**
   * Runs one instruction, skipping any idle cycles while halted first.
   * @returns true when the step is complete; false when a step over or out must keep
   *   running — call {@link runFrame} until it stops with a `step` reason
   */
  step(mode: StepMode): boolean {
    const { gb } = this;
    const { cpu } = gb;
    this.target = null;
    const limit = gb.cycles + CYCLES_PER_FRAME;
    while (!this.executing() && gb.cycles < limit) cpu.step();
    if (mode === 'out') {
      this.target = { kind: 'out', sp: cpu.sp };
      this.resuming = true;
      return false;
    }
    const opcode = gb.peek(cpu.pc);
    const call = CALLS.has(opcode) || isRst(opcode);
    const next = (cpu.pc + (CALLS.has(opcode) ? 3 : 1)) & 0xffff;
    const sp = cpu.sp;
    this.begin(cpu.pc);
    cpu.step();
    this.hit = null;
    this.resuming = false;
    // A CALL whose condition failed, or one that already came back, is finished.
    if (mode === 'over' && call && cpu.pc !== next) {
      this.target = { kind: 'over', pc: next, sp };
      return false;
    }
    return true;
  }

  snapshot(): DebugSnapshot {
    return snapshot(this.gb);
  }

  private breaksAt(pc: number): boolean {
    return (
      (this.breakpoints[pc]! & ANY_BANK) !== 0 ||
      this.breakpointBanks.get(pc)?.has(mappedBank(this.gb)) === true
    );
  }

  /** Notes the instruction about to run at `pc`, for watchpoints. */
  private begin(pc: number): void {
    this.current = pc;
    if (this.gb.onRead === null) return;
    const { gb } = this;
    const opcode = gb.peek(pc);
    const length =
      opcode === 0xcb ? CB_OPCODES[gb.peek((pc + 1) & 0xffff)]!.length : OPCODES[opcode]!.length;
    this.currentEnd = pc + length;
  }

  private readonly onWrite = (addr: number, value: number): void => {
    if (this.watchpoints[addr]! & WATCH_WRITE && this.hit === null) {
      this.hit = { type: 'watchpoint', pc: 0, at: this.current, access: 'write', addr, value };
    }
  };

  private readonly onRead = (addr: number, value: number): void => {
    if ((this.watchpoints[addr]! & WATCH_READ) === 0 || this.hit !== null) return;
    // The CPU fetching the instruction's own bytes isn't a data read. (Interrupt dispatch
    // and HALT read nothing, so a stale range there does no harm.)
    if (addr >= this.current && addr < this.currentEnd) return;
    this.hit = { type: 'watchpoint', pc: 0, at: this.current, access: 'read', addr, value };
  };

  private stop(reason: BreakReason): BreakReason {
    this.hit = null;
    this.target = null;
    this.resuming = true;
    return reason;
  }

  /** The next CPU step runs an instruction or interrupt dispatch, rather than idling. */
  private executing(): boolean {
    const { cpu, interrupts } = this.gb;
    if (cpu.locked) return false;
    if (cpu.stopped) return (interrupts.flags & 0x10) !== 0;
    return !cpu.halted || interrupts.pending() !== 0;
  }
}
