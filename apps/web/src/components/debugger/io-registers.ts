import { IO } from '@reactboy/core';
import { hex2 } from './hex';

export interface IoRegister {
  addr: number;
  name: string;
  /** The value in words, where its bits mean more than the number. */
  describe?: (value: number) => string;
  /** A palette register, shown as swatches. */
  palette?: boolean;
}

export const INTERRUPT_NAMES = ['VBlank', 'STAT', 'Timer', 'Serial', 'Joypad'] as const;

const interrupts = (value: number) =>
  INTERRUPT_NAMES.filter((_, i) => value & (1 << i)).join(', ') || 'None';

const decimal = (value: number) => String(value);

const flags = (value: number, names: [bit: number, on: string, off?: string][]) =>
  names
    .map(([bit, on, off]) => (value & (1 << bit) ? on : off))
    .filter(Boolean)
    .join(', ');

const TIMER_HZ = [4096, 262144, 65536, 16384];
const PPU_MODES = ['HBlank', 'VBlank', 'OAM scan', 'Drawing'];
/** 0xFF10-0xFF25; '-' marks unused addresses. */
const SOUND = (
  'NR10 NR11 NR12 NR13 NR14 - NR21 NR22 NR23 NR24 NR30 NR31 NR32 NR33 NR34 - ' +
  'NR41 NR42 NR43 NR44 NR50 NR51'
).split(' ');
const PAD_LINES = [
  ['Right', 'Left', 'Up', 'Down'],
  ['A', 'B', 'Select', 'Start'],
];

/** Hardware registers by area, with what their bits mean (Pan Docs). */
export const IO_GROUPS: { name: string; registers: IoRegister[] }[] = [
  {
    name: 'LCD',
    registers: [
      {
        addr: IO.LCDC,
        name: 'LCDC',
        describe: (v) =>
          flags(v, [
            [7, 'LCD on', 'LCD off'],
            [0, 'BG on', 'BG off'],
            [3, 'BG map $9C00', 'BG map $9800'],
            [4, 'tiles $8000', 'tiles $8800'],
            [5, 'window on'],
            [6, 'window map $9C00', 'window map $9800'],
            [1, 'sprites on', 'sprites off'],
            [2, '8×16 sprites', '8×8 sprites'],
          ]),
      },
      {
        addr: IO.STAT,
        name: 'STAT',
        describe: (v) => {
          const sources = flags(v, [
            [6, 'LYC'],
            [5, 'OAM'],
            [4, 'VBlank'],
            [3, 'HBlank'],
          ]);
          const coincidence = v & 0x04 ? ', LY=LYC' : '';
          return `${PPU_MODES[v & 3]}${coincidence}; interrupts: ${sources || 'none'}`;
        },
      },
      { addr: IO.SCY, name: 'SCY', describe: decimal },
      { addr: IO.SCX, name: 'SCX', describe: decimal },
      { addr: IO.LY, name: 'LY', describe: decimal },
      { addr: IO.LYC, name: 'LYC', describe: decimal },
      { addr: IO.DMA, name: 'DMA', describe: (v) => `Last copy from $${hex2(v)}00` },
      { addr: IO.BGP, name: 'BGP', palette: true },
      { addr: IO.OBP0, name: 'OBP0', palette: true },
      { addr: IO.OBP1, name: 'OBP1', palette: true },
      { addr: IO.WY, name: 'WY', describe: decimal },
      { addr: IO.WX, name: 'WX', describe: (v) => `${v} (screen x ${v - 7})` },
    ],
  },
  {
    name: 'Interrupts',
    registers: [
      { addr: IO.IF, name: 'IF', describe: (v) => `Requested: ${interrupts(v)}` },
      { addr: IO.IE, name: 'IE', describe: (v) => `Enabled: ${interrupts(v)}` },
    ],
  },
  {
    name: 'Timer',
    registers: [
      { addr: IO.DIV, name: 'DIV', describe: decimal },
      { addr: IO.TIMA, name: 'TIMA', describe: decimal },
      { addr: IO.TMA, name: 'TMA', describe: decimal },
      {
        addr: IO.TAC,
        name: 'TAC',
        describe: (v) => `${v & 4 ? 'On' : 'Off'}, ${TIMER_HZ[v & 3]!.toLocaleString('en')} Hz`,
      },
    ],
  },
  {
    name: 'Joypad and serial',
    registers: [
      {
        addr: IO.P1,
        name: 'P1',
        describe: (v) => {
          const groups = [v & 0x10 ? null : 0, v & 0x20 ? null : 1].filter((g) => g !== null);
          if (groups.length === 0) return 'Nothing selected';
          const held = groups.flatMap((g) => PAD_LINES[g]!.filter((_, bit) => !(v & (1 << bit))));
          const names = groups.map((g) => (g === 0 ? 'd-pad' : 'buttons')).join(' and ');
          return `Reading ${names}; held: ${held.join(', ') || 'none'}`;
        },
      },
      { addr: IO.SB, name: 'SB' },
      {
        addr: IO.SC,
        name: 'SC',
        describe: (v) =>
          `${v & 0x80 ? 'Transferring' : 'Idle'}, ${v & 1 ? 'internal' : 'external'} clock`,
      },
    ],
  },
  {
    name: 'Sound',
    registers: [
      ...SOUND.flatMap((name, i) => (name === '-' ? [] : [{ addr: 0xff10 + i, name }])),
      {
        addr: 0xff26,
        name: 'NR52',
        describe: (v) => {
          if (!(v & 0x80)) return 'Sound off';
          const on = [1, 2, 3, 4].filter((n) => v & (1 << (n - 1)));
          return `Sound on; playing: ${on.length ? on.map((n) => `ch ${n}`).join(', ') : 'none'}`;
        },
      },
    ],
  },
];
