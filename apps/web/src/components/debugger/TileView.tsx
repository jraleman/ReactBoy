import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2, hex4 } from './hex';
import { colorsFor, drawTile, paint } from './vram';

const COLUMNS = 16;
const TILES = 384;
const WIDTH = COLUMNS * 8;
const HEIGHT = (TILES / COLUMNS) * 8;

/** Which tile indices reach a tile in each LCDC bit 4 addressing mode. */
function indices(tile: number): string {
  if (tile < 128) return `$${hex2(tile)} with tiles at $8000`;
  if (tile < 256) return `$${hex2(tile)} in either mode`;
  return `$${hex2(tile - 256)} with tiles at $8800`;
}

/** All 384 tiles in VRAM, in raw shades. */
export function TileView({ snapshot, palette }: ViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState(0);
  const { memory } = snapshot;

  useEffect(() => {
    const colors = colorsFor(palette);
    const pixels = new Uint32Array(WIDTH * HEIGHT);
    for (let tile = 0; tile < TILES; tile++) {
      const x = (tile % COLUMNS) * 8;
      const y = Math.floor(tile / COLUMNS) * 8;
      drawTile(pixels, WIDTH, memory, 0x8000 + tile * 16, x, y, colors);
    }
    paint(canvas.current, pixels);

    const one = new Uint32Array(64);
    drawTile(one, 8, memory, 0x8000 + selected * 16, 0, 0, colors);
    paint(preview.current, one);
  }, [memory, palette, selected]);

  const pick = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * COLUMNS);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * (TILES / COLUMNS));
    setSelected(Math.min(TILES - 1, Math.max(0, y * COLUMNS + x)));
  };

  const addr = 0x8000 + selected * 16;
  return (
    <div className={styles.canvasView}>
      <div className={styles.tileFrame}>
        <canvas
          ref={canvas}
          className={styles.tiles}
          width={WIDTH}
          height={HEIGHT}
          onClick={pick}
          role="img"
          aria-label="Tile data, $8000 to $97FF"
        />
        <svg className={styles.overlay} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
          <rect
            className={styles.pick}
            x={(selected % COLUMNS) * 8 + 0.5}
            y={Math.floor(selected / COLUMNS) * 8 + 0.5}
            width={7}
            height={7}
          />
        </svg>
      </div>
      <div className={styles.details}>
        <canvas ref={preview} className={styles.preview} width={8} height={8} aria-hidden="true" />
        <dl className={styles.facts}>
          <dt>Address</dt>
          <dd className={styles.mono}>
            ${hex4(addr)}–${hex4(addr + 15)}
          </dd>
          <dt>Tile index</dt>
          <dd>{indices(selected)}</dd>
          <dt>Bytes</dt>
          <dd className={styles.mono}>
            {Array.from(memory.subarray(addr, addr + 16), hex2).join(' ')}
          </dd>
        </dl>
        <p className={styles.small}>Click a tile to inspect it. Colors are raw shades 0–3.</p>
      </div>
    </div>
  );
}
