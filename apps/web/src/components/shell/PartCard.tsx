import { useEffect, useId, useRef } from 'react';
import { IO, toAbgr, type DebugSnapshot, type Palette } from '@reactboy/core';
import { useEmulatorClient, useEmulatorState, useProbeState } from '../../hooks/useEmulator';
import { isEditable } from '../../hooks/useKeyboard';
import { colorsFor, drawTile, paint } from '../debugger/vram';
import styles from './GameBoyShell.module.css';
import type { Part } from './parts';

interface Props {
  part: Part;
  palette: Palette;
  /** Beside the device, or over its controls; never over the screen. */
  placement: 'side' | 'sheet';
  onClose: () => void;
}

/** What a part does, with live values from the machine while it is open. */
export function PartCard({ part, palette, placement, onClose }: Props) {
  const client = useEmulatorClient();
  const { status, header, speed, fps } = useEmulatorState();
  const { snapshot, previous, elapsed } = useProbeState();
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();

  useEffect(() => {
    client.setProbing(true);
    return () => client.setProbing(false);
  }, [client]);

  // A new part takes focus, so a keyboard user lands on what they opened.
  useEffect(() => heading.current?.focus(), [part.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isEditable(event.target)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const readings = part.read({ status, header, speed, fps, snapshot, previous, elapsed });

  return (
    <section
      className={styles.card}
      data-placement={placement}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-name`}
    >
      <header className={styles.cardHeader}>
        <h2 id={`${id}-name`} ref={heading} tabIndex={-1} className={styles.cardName}>
          {part.name}
        </h2>
        <button type="button" className={styles.cardClose} aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className={styles.cardAbout}>{part.about}</p>
      <dl className={styles.readings}>
        {readings.map(([label, value]) => (
          <div key={label} className={styles.reading}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {snapshot && part.id === 'wram' && <WramPicture snapshot={snapshot} palette={palette} />}
      {snapshot && part.id === 'vram' && <TilePicture snapshot={snapshot} palette={palette} />}
    </section>
  );
}

const WRAM_START = 0xc000;
const WRAM_SIZE = 0x2000;
/** Work RAM drawn one pixel per byte, 128 bytes to a row. */
const WRAM_WIDTH = 128;
/** Video RAM's 384 tiles, 24 to a row. */
const TILES_ACROSS = 24;
const TILE_ROWS = 16;

function WramPicture({ snapshot, palette }: { snapshot: DebugSnapshot; palette: Palette }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // Lightest color for the highest values, in the screen's own palette.
    const shades = palette.map((rgb) => toAbgr(rgb)).reverse();
    const pixels = new Uint32Array(WRAM_SIZE);
    for (let i = 0; i < WRAM_SIZE; i++) pixels[i] = shades[snapshot.memory[WRAM_START + i]! >> 6]!;
    paint(canvas.current, pixels);
  }, [snapshot, palette]);
  return (
    <canvas
      ref={canvas}
      className={styles.cardPicture}
      width={WRAM_WIDTH}
      height={WRAM_SIZE / WRAM_WIDTH}
      role="img"
      aria-label="Every byte of work RAM, lighter for higher values"
    />
  );
}

function TilePicture({ snapshot, palette }: { snapshot: DebugSnapshot; palette: Palette }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const width = TILES_ACROSS * 8;
    const pixels = new Uint32Array(width * TILE_ROWS * 8);
    const colors = colorsFor(palette, snapshot.memory[IO.BGP]);
    for (let tile = 0; tile < TILES_ACROSS * TILE_ROWS; tile++) {
      const x = (tile % TILES_ACROSS) * 8;
      const y = Math.floor(tile / TILES_ACROSS) * 8;
      drawTile(pixels, width, snapshot.memory, 0x8000 + tile * 16, x, y, colors);
    }
    paint(canvas.current, pixels);
  }, [snapshot, palette]);
  return (
    <canvas
      ref={canvas}
      className={styles.cardPicture}
      width={TILES_ACROSS * 8}
      height={TILE_ROWS * 8}
      role="img"
      aria-label="The 384 tiles in video RAM"
    />
  );
}
