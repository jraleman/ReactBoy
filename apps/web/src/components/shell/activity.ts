import type { BusActivity } from '@reactboy/core';
import type { EmulatorStatus } from '../../worker/client';

/** How busy each part of the board looks, from 0 (idle) to 1. */
export interface BoardActivity {
  /** The CPU itself: lit while executing, dim while halted waiting for an interrupt. */
  cpu: number;
  /** Buses from the CPU, lit by how much the game used them. */
  wram: number;
  vram: number;
  cart: number;
  lcd: number;
  link: number;
  sound: number;
  /** The crystal feeding the CPU, and the power supply. */
  clock: number;
  power: number;
}

export const IDLE: BoardActivity = {
  cpu: 0,
  wram: 0,
  vram: 0,
  cart: 0,
  lcd: 0,
  link: 0,
  sound: 0,
  clock: 0,
  power: 0,
};

/**
 * How lit a bus looks for `count` accesses: as a share of the CPU's M-cycles, against the
 * share (`full`) that lights it fully. The square root keeps light traffic visible.
 */
const level = (count: number, mCycles: number, full: number) =>
  Math.min(1, Math.sqrt(count / mCycles / full));

/**
 * What the board shows for what the machine did over the last ~100 ms. Buses light up by how
 * often the CPU used them; the rest follow hardware registers. Paused games keep their last
 * activity (the board freezes), and with no game the board is dark.
 */
export function boardActivity(status: EmulatorStatus, activity: BusActivity | null): BoardActivity {
  if ((status !== 'running' && status !== 'paused') || !activity || activity.cycles === 0) {
    return IDLE;
  }
  const a = activity;
  const m = a.cycles / 4;
  const busy = 1 - a.idleCycles / a.cycles;
  const channels = a.nr52 & 0x80 ? a.nr52 & 0x0f : 0;
  return {
    // A halted CPU still has its clock running, so it dims rather than going dark.
    cpu: 0.3 + 0.7 * busy,
    // The sprite table is usually copied out of work RAM by DMA once a frame.
    wram: Math.max(level(a.wramReads + a.wramWrites, m, 0.08), a.dmaTransfers ? 0.5 : 0),
    vram: level(a.vramReads + a.vramWrites, m, 0.02),
    cart: Math.max(
      level(a.romReads, m, 0.6),
      level(a.cartRamReads + a.cartRamWrites, m, 0.01),
      a.mbcWrites ? 1 : 0,
    ),
    lcd: a.lcdc & 0x80 ? 1 : 0,
    link: a.serialTransfers || a.sc & 0x80 ? 1 : 0,
    sound: channels ? 0.4 + 0.15 * popcount(channels) : 0,
    clock: 1,
    power: 1,
  };
}

function popcount(bits: number): number {
  let count = 0;
  for (let b = bits; b; b &= b - 1) count++;
  return count;
}
