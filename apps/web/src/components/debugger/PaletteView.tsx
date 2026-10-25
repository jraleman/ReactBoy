import { cgbColorTable } from '@reactboy/core';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex4 } from './hex';
import { cssColor } from './vram';

const KINDS = [
  { name: 'Background', key: 'bgPalettes' },
  { name: 'Sprites', key: 'objPalettes' },
] as const;

/** Game Boy Color palette RAM: eight palettes of four colors for each of the two. */
export function PaletteView({ snapshot, previous, correction }: ViewProps) {
  const { color } = snapshot;
  if (!color) return null;
  const table = cgbColorTable(correction);

  return (
    <div className={styles.palettes}>
      {KINDS.map(({ name, key }) => {
        const ram = color[key];
        const before = previous?.color?.[key];
        return (
          <table key={key} className={styles.table}>
            <caption className={styles.caption}>{name}</caption>
            <tbody>
              {Array.from({ length: 8 }, (_, palette) => {
                const at = palette * 8;
                const colors = [0, 1, 2, 3].map(
                  (id) => (ram[at + id * 2]! | (ram[at + id * 2 + 1]! << 8)) & 0x7fff,
                );
                const changed = before?.subarray(at, at + 8).some((v, i) => v !== ram[at + i]);
                return (
                  <tr key={palette} data-changed={changed || undefined}>
                    <th scope="row">{palette}</th>
                    <td className={styles.mono}>{colors.map(hex4).join(' ')}</td>
                    <td>
                      <span className={styles.swatches} aria-hidden="true">
                        {colors.map((value, id) => (
                          <span key={id} style={{ background: cssColor(table[value]!) }} />
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}
      <p className={styles.small}>
        Colors are 15-bit, red in the low 5 bits and blue in the high ones. Sprites never show color
        0.
      </p>
    </div>
  );
}
