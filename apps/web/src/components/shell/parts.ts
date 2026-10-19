import { CLOCK_HZ, IO, type CartridgeHeader, type DebugSnapshot } from '@reactboy/core';
import type { EmulatorStatus } from '../../worker/client';
import { hex2, hex4 } from '../debugger/hex';
import { INTERRUPT_NAMES } from '../debugger/io-registers';

export type PartId =
  'cartridge' | 'lcd' | 'link' | 'wram' | 'vram' | 'cpu' | 'crystal' | 'power' | 'sound';

/** What a part's live readout is made from. */
export interface ReadoutContext {
  status: EmulatorStatus;
  header: CartridgeHeader | null;
  speed: number;
  fps: number;
  /** Null until the first inspection arrives, and with no game running. */
  snapshot: DebugSnapshot | null;
  previous: DebugSnapshot | null;
  /** Milliseconds between `previous` and `snapshot`. */
  elapsed: number;
}

export type Reading = [label: string, value: string];

export interface Part {
  id: PartId;
  name: string;
  /** Where its hotspot sits on the board, in shell units (see GameBoyShell.module.css). */
  box: { x: number; y: number; w: number; h: number };
  /** What it does, in plain words. */
  about: string;
  /** Live values, given a snapshot; parts that need none ignore it. */
  read: (context: ReadoutContext) => Reading[];
}

const PPU_MODES = ['HBlank', 'VBlank', 'OAM scan', 'Drawing'];
const CPU_STATES = {
  running: 'Running',
  halted: 'Halted (waiting for an interrupt)',
  stopped: 'Stopped',
  locked: 'Locked up',
};
const CHANNELS = ['Pulse 1', 'Pulse 2', 'Wave', 'Noise'];
const WRAM = { start: 0xc000, end: 0xe000 };
const VRAM_TILES = { start: 0x8000, count: 384 };
const OAM = { start: 0xfe00, count: 40 };

const kib = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024} MiB` : `${bytes / 1024} KiB`;

const onOff = (on: boolean) => (on ? 'On' : 'Off');

/** The game's effective clock between two inspections, or null if it can't be told. */
export function measuredClock({
  snapshot,
  previous,
  elapsed,
  status,
}: ReadoutContext): number | null {
  if (status !== 'running' || !snapshot || !previous || elapsed <= 0) return null;
  const cycles = snapshot.cycles - previous.cycles;
  return cycles > 0 ? (cycles / elapsed) * 1000 : null;
}

const mhz = (hz: number, digits = 3) => `${(hz / 1e6).toFixed(digits)} MHz`;

/** Share of the bytes in [start, end) that aren't zero. */
export function usedShare(memory: Uint8Array, start: number, end: number): number {
  let used = 0;
  for (let addr = start; addr < end; addr++) if (memory[addr] !== 0) used++;
  return used / (end - start);
}

/** Tiles in VRAM with any pixel drawn (not all color 0). */
export function tilesInUse(memory: Uint8Array): number {
  let count = 0;
  for (let tile = 0; tile < VRAM_TILES.count; tile++) {
    const addr = VRAM_TILES.start + tile * 16;
    if (memory.subarray(addr, addr + 16).some((byte) => byte !== 0)) count++;
  }
  return count;
}

/** Sprites in OAM placed where they can show on screen. */
export function visibleSprites(memory: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < OAM.count; i++) {
    const y = memory[OAM.start + i * 4]!;
    const x = memory[OAM.start + i * 4 + 1]!;
    if (y > 0 && y < 160 && x > 0 && x < 168) count++;
  }
  return count;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

const NO_GAME: Reading[] = [['Status', 'Load a game to see it work']];

/** The board's parts, in reading order (top to bottom, left to right). */
export const PARTS: Part[] = [
  {
    id: 'cartridge',
    name: 'Cartridge slot & MBC',
    box: { x: 36, y: 13, w: 184, h: 11 },
    about:
      'The game plugs in here. A cartridge holds a ROM chip with the code and graphics. ' +
      'Bigger games add a Memory Bank Controller (MBC), because the CPU can only see 32 KiB ' +
      'of ROM at once: the MBC swaps 16 KiB banks into view when the game asks. Some ' +
      'cartridges also carry battery-backed RAM for saves, and a clock.',
    read: ({ header, snapshot }) => {
      if (!header) return [['Slot', 'Empty']];
      const banks = Math.max(2, header.romSize >> 14);
      return [
        ['Game', header.title || 'Untitled'],
        ['Type', header.typeName],
        ['ROM', `${kib(header.romSize)} in ${banks} banks`],
        ['Bank in view', snapshot ? `${snapshot.romBank} of ${banks}` : '…'],
        [
          'Save RAM',
          header.ramSize > 0
            ? `${kib(header.ramSize)}${header.hasBattery ? ', battery-backed' : ''}`
            : 'None',
        ],
      ];
    },
  },
  {
    id: 'lcd',
    name: 'LCD ribbon & PPU',
    box: { x: 3, y: 56, w: 12, h: 128 },
    about:
      'The picture processor (PPU), built into the CPU chip, draws the screen one line at a ' +
      'time: 144 lines of 160 pixels, about 60 times a second. It builds each line from ' +
      'tiles in video RAM plus up to 10 of the 40 sprites, and this ribbon cable carries ' +
      'the pixels to the LCD’s driver chips.',
    read: ({ snapshot }) => {
      if (!snapshot) return NO_GAME;
      const m = snapshot.memory;
      const lcdc = m[IO.LCDC]!;
      if (!(lcdc & 0x80)) return [['LCD', 'Off']];
      return [
        ['Mode', PPU_MODES[m[IO.STAT]! & 3]!],
        ['Line (LY)', String(m[IO.LY])],
        ['Frame', snapshot.frame.toLocaleString('en-US')],
        ['Scroll', `${m[IO.SCX]}, ${m[IO.SCY]}`],
        ['Window', lcdc & 0x20 ? `At ${m[IO.WX]! - 7}, ${m[IO.WY]}` : 'Off'],
        ['Sprites', lcdc & 0x02 ? `${visibleSprites(m)} on screen` : 'Off'],
      ];
    },
  },
  {
    id: 'link',
    name: 'Link port',
    box: { x: 241, y: 56, w: 12, h: 40 },
    about:
      'A serial port for trading and two-player games, and for the Game Boy Printer. Each ' +
      'transfer swaps a byte with the other side, one bit at a time at 8 kHz. No cable is ' +
      'attached in ReactBoy, so every byte that comes in is $FF.',
    read: ({ snapshot }) => {
      if (!snapshot) return NO_GAME;
      const sc = snapshot.memory[IO.SC]!;
      return [
        ['Data', `$${hex2(snapshot.memory[IO.SB]!)}`],
        ['Transfer', sc & 0x80 ? 'In progress' : 'Idle'],
        ['Clock', sc & 0x01 ? 'This Game Boy' : 'The other Game Boy'],
      ];
    },
  },
  {
    id: 'wram',
    name: 'Work RAM',
    box: { x: 148, y: 206, w: 44, h: 19 },
    about:
      'The game’s 8 KiB of scratch memory, at $C000–$DFFF: its variables, the stack and, in ' +
      'most games, a copy of the sprite table that is sent to the PPU every frame. The ' +
      'picture below is every byte, lighter for higher values.',
    read: ({ snapshot }) => {
      if (!snapshot) return NO_GAME;
      const { sp } = snapshot;
      const where =
        sp >= WRAM.start && sp < WRAM.end ? 'work RAM' : sp >= 0xff80 ? 'high RAM' : 'elsewhere';
      return [
        [
          'In use',
          `${percent(usedShare(snapshot.memory, WRAM.start, WRAM.end))} of bytes non-zero`,
        ],
        ['Stack', `$${hex4(sp)} (${where})`],
      ];
    },
  },
  {
    id: 'vram',
    name: 'Video RAM',
    box: { x: 196, y: 206, w: 44, h: 19 },
    about:
      'Holds the graphics, at $8000–$9FFF: 384 tiles of 8×8 pixels, and two 32×32 maps that ' +
      'arrange them into backgrounds. The PPU reads it all the time; the CPU can only reach ' +
      'it while the PPU isn’t drawing. Below are the tiles as they are now.',
    read: ({ snapshot }) => {
      if (!snapshot) return NO_GAME;
      const lcdc = snapshot.memory[IO.LCDC]!;
      return [
        ['Tiles drawn', `${tilesInUse(snapshot.memory)} of ${VRAM_TILES.count}`],
        ['Background map', lcdc & 0x08 ? '$9C00' : '$9800'],
        ['Tile data', lcdc & 0x10 ? '$8000' : '$8800'],
      ];
    },
  },
  {
    id: 'cpu',
    name: 'CPU (DMG-CPU)',
    box: { x: 98, y: 251, w: 48, h: 48 },
    about:
      'The brain: a Sharp SM83 core, a cousin of the Z80 and Intel 8080, running at 4.19 MHz. ' +
      'The same chip also holds the picture processor, the sound generator, the timer, ' +
      '127 bytes of fast high RAM, and the 256-byte boot ROM that scrolls the logo.',
    read: (context) => {
      const { snapshot } = context;
      if (!snapshot) return NO_GAME;
      const clock = measuredClock(context);
      const enabled = INTERRUPT_NAMES.filter((_, bit) => snapshot.memory[IO.IE]! & (1 << bit));
      return [
        ['State', context.status === 'paused' ? 'Paused' : CPU_STATES[snapshot.cpu]],
        ['PC', `$${hex4(snapshot.pc)}`],
        ['SP', `$${hex4(snapshot.sp)}`],
        ['AF BC DE HL', [snapshot.af, snapshot.bc, snapshot.de, snapshot.hl].map(hex4).join(' ')],
        ['Interrupts', snapshot.ime ? enabled.join(', ') || 'None enabled' : 'Masked'],
        ['Clock', clock === null ? '—' : mhz(clock, 2)],
      ];
    },
  },
  {
    id: 'crystal',
    name: 'Crystal oscillator',
    box: { x: 101, y: 302, w: 28, h: 14 },
    about:
      'A sliver of quartz that vibrates 4,194,304 (2²²) times a second. It is the clock ' +
      'every part steps to: one frame takes 70,224 of its ticks, which is why the Game Boy ' +
      'runs at 59.7 frames per second rather than 60.',
    read: (context) => {
      const clock = measuredClock(context);
      return [
        ['Nominal', mhz(CLOCK_HZ)],
        ['Emulated now', clock === null ? '—' : mhz(clock, 2)],
        ['Speed', `${context.speed}×`],
        ['Frames per second', context.status === 'running' ? String(context.fps) : '—'],
      ];
    },
  },
  {
    id: 'power',
    name: 'Power regulator',
    box: { x: 12, y: 330, w: 54, h: 50 },
    about:
      'Turns the four AA batteries’ 6 V into the steady 5 V the chips run on, plus the ' +
      'negative voltage the LCD needs; the contrast wheel adjusts that one. As the ' +
      'batteries run down, the power LED dims.',
    read: ({ status }) => [
      ['Power', onOff(status === 'running' || status === 'paused')],
      ['Batteries', 'Emulated: always fresh'],
    ],
  },
  {
    id: 'sound',
    name: 'Speaker & amp',
    box: { x: 177, y: 330, w: 54, h: 54 },
    about:
      'Four sound channels in the CPU chip (two square-wave pulses, a wave player and a noise ' +
      'generator) are mixed into left and right. A small amplifier then drives this ' +
      'speaker, or the headphone jack in stereo.',
    read: ({ snapshot }) => {
      if (!snapshot) return NO_GAME;
      const nr52 = snapshot.memory[0xff26]!;
      if (!(nr52 & 0x80)) return [['Sound', 'Off']];
      const nr50 = snapshot.memory[0xff24]!;
      const on = CHANNELS.filter((_, i) => nr52 & (1 << i));
      return [
        ['Channels on', on.join(', ') || 'None'],
        ['Volume', `Left ${((nr50 >> 4) & 7) + 1}/8, right ${(nr50 & 7) + 1}/8`],
      ];
    },
  },
];
