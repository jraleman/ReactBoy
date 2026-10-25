import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2, hex4 } from './hex';
import { colorsFor, drawTile, paint, tileSource } from './vram';

const COLUMNS = 16;
const TILES = 384;
const ROWS = TILES / COLUMNS;

/** Which tile indices reach a tile in each LCDC bit 4 addressing mode. */
function indices(tile: number): string {
  if (tile < 128) return `$${hex2(tile)} with tiles at $8000`;
  if (tile < 256) return `$${hex2(tile)} in either mode`;
  return `$${hex2(tile - 256)} with tiles at $8800`;
}

/** All 384 tiles in VRAM, in raw shades; a Game Boy Color's second bank beside them. */
export function TileView({ snapshot, palette }: ViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState({ bank: 0, tile: 0 });
  const banks = snapshot.color ? 2 : 1;
  const width = banks * COLUMNS * 8;
  const height = ROWS * 8;
  const bank = Math.min(selected.bank, banks - 1);
  const addr = 0x8000 + selected.tile * 16;
  const [bytes, offset] = tileSource(snapshot, addr, bank);

  useEffect(() => {
    const colors = colorsFor(palette);
    const pixels = new Uint32Array(width * height);
    for (let b = 0; b < banks; b++) {
      for (let tile = 0; tile < TILES; tile++) {
        const x = (b * COLUMNS + (tile % COLUMNS)) * 8;
        const y = Math.floor(tile / COLUMNS) * 8;
        drawTile(pixels, width, ...tileSource(snapshot, 0x8000 + tile * 16, b), x, y, colors);
      }
    }
    paint(canvas.current, pixels);

    const one = new Uint32Array(64);
    drawTile(one, 8, bytes, offset, 0, 0, colors);
    paint(preview.current, one);
  }, [snapshot, palette, banks, width, height, bytes, offset]);

  const pick = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
    const x = clamp(
      Math.floor(((event.clientX - rect.left) / rect.width) * banks * COLUMNS),
      banks * COLUMNS,
    );
    const y = clamp(Math.floor(((event.clientY - rect.top) / rect.height) * ROWS), ROWS);
    setSelected({ bank: Math.floor(x / COLUMNS), tile: y * COLUMNS + (x % COLUMNS) });
  };

  return (
    <div className={styles.canvasView}>
      <div className={styles.tileFrame} data-banks={banks === 2 || undefined}>
        <canvas
          ref={canvas}
          className={styles.tiles}
          width={width}
          height={height}
          onClick={pick}
          role="img"
          aria-label={`Tile data, $8000 to $97FF${banks === 2 ? ', banks 0 and 1' : ''}`}
        />
        <svg className={styles.overlay} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {banks === 2 && <line className={styles.bankRule} x1={128} x2={128} y1={0} y2={height} />}
          <rect
            className={styles.pick}
            x={(bank * COLUMNS + (selected.tile % COLUMNS)) * 8 + 0.5}
            y={Math.floor(selected.tile / COLUMNS) * 8 + 0.5}
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
            {banks === 2 && `, bank ${bank}`}
          </dd>
          <dt>Tile index</dt>
          <dd>{indices(selected.tile)}</dd>
          <dt>Bytes</dt>
          <dd className={styles.mono}>
            {Array.from(bytes.subarray(offset, offset + 16), hex2).join(' ')}
          </dd>
        </dl>
        <p className={styles.small}>
          Click a tile to inspect it. Colors are raw shades 0–3.
          {banks === 2 && ' Bank 0 is on the left, bank 1 on the right.'}
        </p>
      </div>
    </div>
  );
}
