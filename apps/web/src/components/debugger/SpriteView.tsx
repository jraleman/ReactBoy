import { useEffect, useRef } from 'react';
import { IO, type DebugSnapshot } from '@reactboy/core';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2 } from './hex';
import { colorColorsFor, colorsFor, drawTile, paint, tileSource } from './vram';

const SPRITES = 40;

/**
 * The 40 entries of OAM, previewed with their palettes and flips. On a Game Boy Color the
 * attributes pick one of eight palettes and a VRAM bank instead of OBP0 or OBP1.
 */
export function SpriteView({ snapshot, palette, correction }: ViewProps) {
  const { memory, color } = snapshot;
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
              color && attr & 0x08 && 'Bank 1',
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
                    snapshot={snapshot}
                    tile={height === 16 ? tile & 0xfe : tile}
                    attr={attr}
                    height={height}
                    colors={
                      color
                        ? colorColorsFor(color.objPalettes, attr & 7, correction, true)
                        : colorsFor(palette, memory[attr & 0x10 ? IO.OBP1 : IO.OBP0], true)
                    }
                  />
                </td>
                <td>{x - 8}</td>
                <td>{y - 16}</td>
                <td className={styles.mono}>${hex2(tile)}</td>
                <td>{color ? attr & 7 : `OBP${attr & 0x10 ? 1 : 0}`}</td>
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
  snapshot: DebugSnapshot;
  tile: number;
  attr: number;
  height: number;
  colors: Uint32Array;
}

function SpritePreview({ snapshot, tile, attr, height, colors }: PreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const pixels = new Uint32Array(8 * height);
    const bank = snapshot.color ? (attr >> 3) & 1 : 0;
    drawTile(pixels, 8, ...tileSource(snapshot, 0x8000 + tile * 16, bank), 0, 0, colors, {
      flipX: (attr & 0x20) !== 0,
      flipY: (attr & 0x40) !== 0,
      height,
    });
    paint(canvas.current, pixels);
  }, [snapshot, tile, attr, height, colors]);
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
