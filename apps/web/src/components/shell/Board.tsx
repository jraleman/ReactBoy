import { memo, type CSSProperties, type ReactNode } from 'react';
import type { BoardActivity } from './activity';
import styles from './GameBoyShell.module.css';

/** `n` shapes, made from their index. */
const row = (n: number, make: (i: number) => ReactNode) =>
  Array.from({ length: n }, (_, i) => make(i));

/** A dual-row chip (WRAM, VRAM, amp) with its pins on the long sides. */
function Sop({
  x,
  y,
  w,
  h,
  pins,
  label,
  sub,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  pins: number;
  label: string;
  sub?: string;
}) {
  const pitch = (w - 3) / pins;
  return (
    <g>
      {row(pins, (i) => (
        <g key={i} className={styles.pin}>
          <rect
            x={x + 1.5 + i * pitch + pitch * 0.2}
            y={y - 1.6}
            width={pitch * 0.6}
            height={1.8}
          />
          <rect
            x={x + 1.5 + i * pitch + pitch * 0.2}
            y={y + h - 0.2}
            width={pitch * 0.6}
            height={1.8}
          />
        </g>
      ))}
      <rect className={styles.chip} x={x} y={y} width={w} height={h} rx={0.8} />
      <circle className={styles.pinOne} cx={x + 2.2} cy={y + h - 2.2} r={0.8} />
      <text className={styles.chipText} x={x + w / 2} y={y + h / 2 + (sub ? -0.4 : 1.4)}>
        {label}
      </text>
      {sub && (
        <text className={styles.chipSub} x={x + w / 2} y={y + h / 2 + 3.6}>
          {sub}
        </text>
      )}
    </g>
  );
}

/** Parallel runs of copper: `path(i)` draws the i-th of `n`. */
const lines = (n: number, path: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => path(i));

interface Bus {
  /** What lights its signals up. */
  activity: keyof BoardActivity;
  paths: string[];
  /** Signals run against the direction the paths are drawn in. */
  inward?: boolean;
}

/** The traces, each drawn from the end its data leaves (mostly the CPU). */
const BUSES: Bus[] = [
  {
    activity: 'wram',
    paths: lines(4, (i) => `M${126 + i * 2} 252 V${228 + i * 2} H${160 + i * 4} V224`),
  },
  { activity: 'vram', paths: lines(4, (i) => `M145 ${258 + i * 2} H${204 + i * 4} V224`) },
  { activity: 'cart', paths: lines(5, (i) => `M${106 + i * 2.4} 252 V200`) },
  {
    activity: 'lcd',
    paths: lines(4, (i) => `M${7 + i * 2} 186 V${276 - i * 2} H100`),
    inward: true,
  },
  { activity: 'clock', paths: lines(2, (i) => `M${112 + i * 6} 297 V303`), inward: true },
  {
    activity: 'sound',
    paths: [
      ...lines(3, (i) => `M${134 + i * 2.4} 297 V${368 - i * 2} H${150 + i * 3} V371`),
      ...lines(2, (i) => `M165 ${375 + i * 3} H${187 + i * 3}`),
    ],
  },
  { activity: 'link', paths: lines(3, (i) => `M241 ${64 + i * 8} H234`), inward: true },
];

const POWER: Bus = {
  activity: 'power',
  paths: ['M54 342 H70 V392 H150 V383', 'M30 343 V330 H92 V300', 'M24 362 V398 H64'],
};

/** Opacity that follows a part's activity, set as a custom property by LiveBoard. */
const lit = (activity: keyof BoardActivity): CSSProperties => ({
  opacity: `var(--${activity}, 0)`,
});

/** Pulses travelling along a bus, faded in and out with its activity. */
function Signals({ bus, index }: { bus: Bus; index: number }) {
  return (
    <g className={styles.signals} style={lit(bus.activity)}>
      {bus.paths.map((d, i) => (
        <path
          key={d}
          d={d}
          data-inward={bus.inward || undefined}
          // Stagger the runs so a bus doesn't pulse in lockstep.
          style={{ animationDelay: `${-(index * 0.17 + i * 0.09)}s` }}
        />
      ))}
    </g>
  );
}

/** A warm halo under a chip while it works. */
const Glow = ({
  activity,
  x,
  y,
  w,
  h,
}: {
  activity: keyof BoardActivity;
  x: number;
  y: number;
  w: number;
  h: number;
}) => (
  <rect
    className={styles.glow}
    x={x}
    y={y}
    width={w}
    height={h}
    fill="url(#board-glow)"
    style={lit(activity)}
  />
);

/** Small surface-mount resistors and capacitors, scattered where the case shows them. */
const PASSIVES: [x: number, y: number, vertical?: boolean][] = [
  [92, 244],
  [96, 300, true],
  [148, 300],
  [150, 236],
  [141, 318, true],
  [74, 384],
  [82, 384],
  [100, 386],
  [112, 386],
  [20, 236],
  [28, 236],
  [244, 108, true],
  [244, 116, true],
  [196, 232],
  [230, 232],
];

/** Screw posts holding the board, as [x, y]. */
const SCREWS: [number, number][] = [
  [12, 32],
  [244, 32],
  [12, 318],
  [245, 238],
];

/**
 * The circuit board behind a clear case: a stylised single board with the chips that really
 * sit on two (see parts.ts for what each one is). Drawn in shell units; decorative only —
 * the hotspots over it are the accessible part.
 */
export const Board = memo(function Board() {
  return (
    <svg className={styles.board} viewBox="0 0 256 410" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="board-fill" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#1f5440" />
          <stop offset="1" stopColor="#123526" />
        </linearGradient>
        <linearGradient id="board-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f3f6" />
          <stop offset="0.5" stopColor="#a9adb6" />
          <stop offset="1" stopColor="#d9dce2" />
        </linearGradient>
        <radialGradient id="board-cone" cx="0.45" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#4b4b54" />
          <stop offset="1" stopColor="#1d1d22" />
        </radialGradient>
        <radialGradient id="board-glow">
          <stop offset="0" stopColor="#ffd68a" stopOpacity="0.55" />
          <stop offset="0.55" stopColor="#ffc35c" stopOpacity="0.18" />
          <stop offset="1" stopColor="#ffc35c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="board-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1c4" stopOpacity="0" />
          <stop offset="0.7" stopColor="#fff1c4" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff1c4" stopOpacity="0" />
        </linearGradient>
        <pattern id="board-vias" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="0.45" fill="#2f6b52" />
        </pattern>
      </defs>

      {/* The board follows the case outline, with the speaker's corner cut round. */}
      <path
        className={styles.pcb}
        d="M10 3 H246 Q252 3 252 9 V356 A48 48 0 0 1 204 404 H10 Q4 404 4 398 V9 Q4 3 10 3 Z"
        fill="url(#board-fill)"
      />
      <path
        d="M10 3 H246 Q252 3 252 9 V356 A48 48 0 0 1 204 404 H10 Q4 404 4 398 V9 Q4 3 10 3 Z"
        fill="url(#board-vias)"
      />

      <g className={styles.traces}>
        {BUSES.flatMap((bus) => bus.paths).map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g className={styles.powerTraces}>
        {POWER.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g className={styles.powerGlow} style={lit('power')}>
        {POWER.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {BUSES.map((bus, index) => (
        <Signals key={index} bus={bus} index={index} />
      ))}

      <Glow activity="cpu" x={88} y={241} w={68} h={68} />
      <Glow activity="wram" x={140} y={200} w={60} h={31} />
      <Glow activity="vram" x={188} y={200} w={60} h={31} />

      {SCREWS.map(([x, y]) => (
        <g key={`${x},${y}`}>
          <circle className={styles.screwRing} cx={x} cy={y} r={4.2} />
          <circle className={styles.screw} cx={x} cy={y} r={2.6} />
          <path
            className={styles.screwSlot}
            d={`M${x - 1.6} ${y} H${x + 1.6} M${x} ${y - 1.6} V${y + 1.6}`}
          />
        </g>
      ))}

      {PASSIVES.map(([x, y, vertical]) => (
        <g key={`${x},${y}`} className={styles.passive}>
          <rect x={x} y={y} width={vertical ? 1.8 : 3.4} height={vertical ? 3.4 : 1.8} rx={0.3} />
        </g>
      ))}

      {/* Cartridge connector: 32 gold contacts. */}
      <rect className={styles.connector} x={40} y={14.5} width={176} height={8} rx={1} />
      <rect fill="#0c0c0f" x={42.5} y={16.5} width={171} height={2.4} rx={0.6} />
      {row(32, (i) => (
        <rect
          key={i}
          className={styles.gold}
          x={44.4 + i * 5.3}
          y={19.4}
          width={2.6}
          height={2.4}
        />
      ))}

      {/* LCD ribbon cable down the left of the screen. */}
      <rect className={styles.ribbon} x={5} y={58} width={9} height={124} rx={1} />
      {row(6, (i) => (
        <path key={i} className={styles.ribbonLine} d={`M${6.4 + i * 1.25} 59 V181`} />
      ))}
      {/* The line being drawn, slowed down from 60 sweeps a second to one you can follow. */}
      <rect
        className={styles.scan}
        x={5}
        y={58}
        width={9}
        height={18}
        fill="url(#board-scan)"
        style={lit('lcd')}
      />
      <rect className={styles.socket} x={4} y={178} width={11} height={8} rx={0.8} />

      {/* Link port socket on the right edge. */}
      <rect className={styles.connector} x={242} y={57} width={9} height={38} rx={1.6} />
      <path fill="#0c0c0f" d="M244.5 62 H248.5 L249.5 66 V86 L248.5 90 H244.5 Z" />
      {row(3, (i) => (
        <rect key={i} className={styles.gold} x={245.8} y={68 + i * 6} width={1.6} height={3} />
      ))}
      <text className={styles.silk} x={246.5} y={101} textAnchor="middle">
        EXT
      </text>

      <Sop x={150} y={209} w={40} h={13} pins={14} label="WRAM" sub="8 KiB" />
      <Sop x={198} y={209} w={40} h={13} pins={14} label="VRAM" sub="8 KiB" />
      <text className={styles.silk} x={150} y={206}>
        U2
      </text>
      <text className={styles.silk} x={198} y={206}>
        U3
      </text>

      {/* The CPU: an 80-pin flat pack, 20 pins a side. */}
      <g>
        {row(20, (i) => {
          const at = 105 + i * 1.75;
          return (
            <g key={i} className={styles.pin}>
              <rect x={at} y={253} width={0.9} height={3.2} />
              <rect x={at} y={293.8} width={0.9} height={3.2} />
              <rect x={100} y={at + 153} width={3.2} height={0.9} />
              <rect x={140.8} y={at + 153} width={3.2} height={0.9} />
            </g>
          );
        })}
        <rect className={styles.chip} x={103} y={256} width={38} height={38} rx={1.2} />
        <rect className={styles.chipSheen} x={104.5} y={257.5} width={35} height={35} rx={0.8} />
        <circle className={styles.pinOne} cx={107} cy={290} r={1.2} />
        <text className={styles.cpuText} x={122} y={273}>
          DMG-CPU
        </text>
        <text className={styles.chipSub} x={122} y={279}>
          SM83 · 4.19 MHz
        </text>
        <text className={styles.chipSub} x={122} y={286}>
          REACTBOY
        </text>
      </g>
      <text className={styles.silk} x={98.5} y={250}>
        U1
      </text>

      {/* Crystal. */}
      <rect fill="url(#board-metal)" x={104} y={304} width={22} height={9} rx={4.5} />
      <text className={styles.crystalText} x={115} y={310.2}>
        4.194M
      </text>
      <text className={styles.silk} x={128} y={311}>
        X1
      </text>

      {/* Power regulator: inductor, controller and filter capacitors. */}
      <circle className={styles.inductor} cx={25} cy={350} r={8.5} />
      <circle className={styles.inductorWinding} cx={25} cy={350} r={5.6} />
      <circle fill="#15151a" cx={25} cy={350} r={2.4} />
      <Sop x={38} y={337} w={16} h={8} pins={4} label="DC" />
      <circle className={styles.capacitor} cx={46} cy={364} r={6} />
      <path className={styles.capacitorVent} d="M42.5 364 H49.5 M46 360.5 V367.5" />
      <circle className={styles.capacitor} cx={59} cy={366} r={4.4} />
      <path className={styles.capacitorVent} d="M56.4 366 H61.6 M59 363.4 V368.6" />
      <text className={styles.silk} x={32} y={378}>
        L1 DC-DC
      </text>

      {/* Sound: the amp and the speaker under the grille. */}
      <Sop x={147} y={372} w={18} h={9} pins={4} label="AMP" />
      <circle fill="url(#board-cone)" cx={204} cy={357} r={25} />
      <circle className={styles.coneRing} cx={204} cy={357} r={21.5} />
      <circle className={styles.coneRing} cx={204} cy={357} r={13} />
      <circle fill="#55555e" cx={204} cy={357} r={7} />
      <text className={styles.silk} x={176} y={392}>
        SP1
      </text>

      <text className={styles.silk} x={128} y={401} textAnchor="middle">
        REACTBOY · DMG-CPU-01
      </text>
    </svg>
  );
});
