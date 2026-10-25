import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { IO, type DebugSnapshot } from '@reactboy/core';
import panel from '../panel/Panel.module.css';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2, hex4 } from './hex';
import { colorColorsFor, colorsFor, drawTile, paint, tileAddress, tileSource } from './vram';

const SIZE = 256;
const MAPS = [0x9800, 0x9c00] as const;

/** Entry `i` of the tile map at `map`: its tile index and attributes (always 0 on a DMG). */
function mapEntry({ memory, color }: DebugSnapshot, map: number, i: number): [number, number] {
  // VBK may have bank 1 mapped in, so a Game Boy Color's map is read from VRAM itself.
  if (!color) return [memory[map + i]!, 0];
  const at = map - 0x8000 + i;
  return [color.vram[at]!, color.vram[0x2000 + at]!];
}

/** A Game Boy Color map attribute (from VRAM bank 1) in words. */
function describeAttributes(attr: number): string {
  const flags = [attr & 0x20 && 'X flip', attr & 0x40 && 'Y flip', attr & 0x80 && 'over sprites'];
  return [`palette ${attr & 7}`, `bank ${(attr >> 3) & 1}`, ...flags].filter(Boolean).join(', ');
}

/**
 * A 256x256 tile map with the screen's viewport (and the window's) outlined. On a Game Boy
 * Color each tile also takes its palette, bank and flips from the attribute map in bank 1.
 */
export function MapView({ snapshot, palette, correction }: ViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const id = useId();
  const { memory, color } = snapshot;
  const lcdc = memory[IO.LCDC]!;
  const bgMap = lcdc & 0x08 ? 0x9c00 : 0x9800;
  const windowMap = lcdc & 0x40 ? 0x9c00 : 0x9800;
  /** null follows the map the background is using. */
  const [chosen, setChosen] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const map = chosen ?? bgMap;

  useEffect(() => {
    const dmgColors = colorsFor(palette, memory[IO.BGP]);
    const palettes =
      color && Array.from({ length: 8 }, (_, i) => colorColorsFor(color.bgPalettes, i, correction));
    const pixels = new Uint32Array(SIZE * SIZE);
    for (let i = 0; i < 1024; i++) {
      const [tile, attr] = mapEntry(snapshot, map, i);
      const [bytes, addr] = tileSource(snapshot, tileAddress(lcdc, tile), (attr >> 3) & 1);
      drawTile(
        pixels,
        SIZE,
        bytes,
        addr,
        (i % 32) * 8,
        Math.floor(i / 32) * 8,
        palettes?.[attr & 7] ?? dmgColors,
        { flipX: (attr & 0x20) !== 0, flipY: (attr & 0x40) !== 0 },
      );
    }
    paint(canvas.current, pixels);
  }, [snapshot, color, memory, palette, correction, lcdc, map]);

  const pick = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * 32);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * 32);
    setSelected(Math.min(31, Math.max(0, y)) * 32 + Math.min(31, Math.max(0, x)));
  };

  const scx = memory[IO.SCX]!;
  const scy = memory[IO.SCY]!;
  const wx = memory[IO.WX]! - 7;
  const wy = memory[IO.WY]!;
  const windowShown = (lcdc & 0x20) !== 0 && wx < 160 && wy < 144;
  const [tile, attr] = selected === null ? [null, 0] : mapEntry(snapshot, map, selected);

  return (
    <div className={styles.canvasView}>
      <div className={styles.mapFrame}>
        <canvas
          ref={canvas}
          className={styles.map}
          width={SIZE}
          height={SIZE}
          onClick={pick}
          role="img"
          aria-label={`Tile map at $${hex4(map)}`}
        />
        <svg className={styles.overlay} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {map === bgMap &&
            [0, -SIZE].flatMap((dx) =>
              [0, -SIZE].map((dy) => (
                <rect
                  key={`${dx},${dy}`}
                  className={styles.viewport}
                  x={scx + dx + 0.5}
                  y={scy + dy + 0.5}
                  width={159}
                  height={143}
                />
              )),
            )}
          {map === windowMap && windowShown && (
            <rect
              className={styles.windowRect}
              x={0.5}
              y={0.5}
              width={160 - Math.max(wx, 0) - 1}
              height={144 - wy - 1}
            />
          )}
          {selected !== null && (
            <rect
              className={styles.pick}
              x={(selected % 32) * 8 + 0.5}
              y={Math.floor(selected / 32) * 8 + 0.5}
              width={7}
              height={7}
            />
          )}
        </svg>
      </div>
      <div className={styles.details}>
        <fieldset className={panel.fieldset}>
          <legend className={panel.legend}>Map</legend>
          <div className={panel.segmented}>
            {MAPS.map((addr) => (
              <label key={addr} className={panel.segment}>
                <input
                  type="radio"
                  name={`${id}-map`}
                  checked={map === addr}
                  onChange={() => setChosen(addr)}
                />
                <span>${hex4(addr)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <dl className={styles.facts}>
          <dt>Background</dt>
          <dd>
            ${hex4(bgMap)}, scroll {scx},{scy}
            {lcdc & 0x01 ? '' : ' (off)'}
          </dd>
          <dt>Window</dt>
          <dd>{windowShown ? `$${hex4(windowMap)}, at ${wx},${wy}` : 'Hidden'}</dd>
          <dt>Tiles</dt>
          <dd>{lcdc & 0x10 ? '$8000, unsigned' : '$8800, signed'}</dd>
          {selected !== null && tile !== null && (
            <>
              <dt>Selected</dt>
              <dd className={styles.mono}>
                ${hex4(map + selected)} → tile ${hex2(tile)} at ${hex4(tileAddress(lcdc, tile))}
              </dd>
              {color && (
                <>
                  <dt>Attributes</dt>
                  <dd>{describeAttributes(attr)}</dd>
                </>
              )}
            </>
          )}
        </dl>
        <p className={styles.small}>
          <span className={styles.keyViewport} /> Screen <span className={styles.keyWindow} />{' '}
          Window. {color ? 'Colors come from background palette RAM.' : 'Colors go through BGP.'}
        </p>
      </div>
    </div>
  );
}
