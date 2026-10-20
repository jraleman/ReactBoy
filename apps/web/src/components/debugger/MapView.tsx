import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { IO } from '@reactboy/core';
import panel from '../panel/Panel.module.css';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2, hex4 } from './hex';
import { colorsFor, drawTile, paint, tileAddress } from './vram';

const SIZE = 256;
const MAPS = [0x9800, 0x9c00] as const;

/** A 256x256 tile map with the screen's viewport (and the window's) outlined. */
export function MapView({ snapshot, palette }: ViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const id = useId();
  const { memory } = snapshot;
  const lcdc = memory[IO.LCDC]!;
  const bgMap = lcdc & 0x08 ? 0x9c00 : 0x9800;
  const windowMap = lcdc & 0x40 ? 0x9c00 : 0x9800;
  /** null follows the map the background is using. */
  const [chosen, setChosen] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const map = chosen ?? bgMap;

  useEffect(() => {
    const colors = colorsFor(palette, memory[IO.BGP]);
    const pixels = new Uint32Array(SIZE * SIZE);
    for (let i = 0; i < 1024; i++) {
      const addr = tileAddress(lcdc, memory[map + i]!);
      drawTile(pixels, SIZE, memory, addr, (i % 32) * 8, Math.floor(i / 32) * 8, colors);
    }
    paint(canvas.current, pixels);
  }, [memory, palette, lcdc, map]);

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
  const tile = selected === null ? null : memory[map + selected]!;

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
            </>
          )}
        </dl>
        <p className={styles.small}>
          <span className={styles.keyViewport} /> Screen <span className={styles.keyWindow} />{' '}
          Window. Colors go through BGP.
        </p>
      </div>
    </div>
  );
}
