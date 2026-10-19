import { useEffect, useRef } from 'react';
import { IO } from '@reactboy/core';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2 } from './hex';
import { colorsFor, drawTile, paint } from './vram';

const SPRITES = 40;

/** The 40 entries of OAM, previewed with their palettes and flips. */
export function SpriteView({ snapshot, palette }: ViewProps) {
  const { memory } = snapshot;
  const lcdc = memory[IO.LCDC]!;
  const height = lcdc & 0x04 ? 16 : 8;

  return (
    <div className={styles.spriteView}>
      <p className={styles.small}>
        {height === 16 ? '8×16' : '8×8'} sprites, {lcdc & 0x02 ? 'shown' : 'hidden'}. Off-screen
        entries are dimmed.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Sprite</th>
            <th scope="col">X</th>
            <th scope="col">Y</th>
            <th scope="col">Tile</th>
            <th scope="col">Palette</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SPRITES }, (_, i) => {
            const base = 0xfe00 + i * 4;
            const y = memory[base]!;
            const x = memory[base + 1]!;
            const tile = memory[base + 2]!;
            const attr = memory[base + 3]!;
            const visible = x > 0 && x < 168 && y + height > 16 && y < 160;
            const flags = [
              attr & 0x20 && 'X flip',
              attr & 0x40 && 'Y flip',
              attr & 0x80 && 'Behind BG',
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <tr key={i} data-dim={!visible || undefined}>
                <td>{i}</td>
                <td>
                  <SpritePreview
                    memory={memory}
                    tile={height === 16 ? tile & 0xfe : tile}
                    attr={attr}
                    height={height}
                    colors={colorsFor(palette, memory[attr & 0x10 ? IO.OBP1 : IO.OBP0], true)}
                  />
                </td>
                <td>{x - 8}</td>
                <td>{y - 16}</td>
                <td className={styles.mono}>${hex2(tile)}</td>
                <td>OBP{attr & 0x10 ? 1 : 0}</td>
                <td>{flags || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface PreviewProps {
  memory: Uint8Array;
  tile: number;
  attr: number;
  height: number;
  colors: Uint32Array;
}

function SpritePreview({ memory, tile, attr, height, colors }: PreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const pixels = new Uint32Array(8 * height);
    drawTile(pixels, 8, memory, 0x8000 + tile * 16, 0, 0, colors, {
      flipX: (attr & 0x20) !== 0,
      flipY: (attr & 0x40) !== 0,
      height,
    });
    paint(canvas.current, pixels);
  }, [memory, tile, attr, height, colors]);
  return (
    <canvas
      ref={canvas}
      className={styles.sprite}
      width={8}
      height={height}
      data-tall={height === 16 || undefined}
      aria-hidden="true"
    />
  );
}
