import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2, hex4 } from './hex';
import { IO_GROUPS } from './io-registers';

const css = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** Hardware registers with their bits spelled out, plus wave RAM. */
export function IoView({ snapshot, previous, palette }: ViewProps) {
  const { memory } = snapshot;
  const before = previous?.memory;

  return (
    <div className={styles.io}>
      {IO_GROUPS.map((group) => (
        <table key={group.name} className={styles.table}>
          <caption className={styles.caption}>{group.name}</caption>
          <tbody>
            {group.registers.map(({ addr, name, describe, palette: isPalette }) => {
              const value = memory[addr]!;
              return (
                <tr key={addr} data-changed={(before && before[addr] !== value) || undefined}>
                  <th scope="row">
                    {name}
                    <span className={styles.ioAddr}>{hex4(addr)}</span>
                  </th>
                  <td className={styles.mono}>{hex2(value)}</td>
                  <td className={styles.bits}>{value.toString(2).padStart(8, '0')}</td>
                  <td>
                    {isPalette ? (
                      <span className={styles.swatches} aria-label={paletteLabel(value)}>
                        {[0, 1, 2, 3].map((id) => (
                          <span
                            key={id}
                            style={{ background: css(palette[(value >> (id * 2)) & 3]!) }}
                          />
                        ))}
                      </span>
                    ) : (
                      describe?.(value)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      <section aria-label="Wave RAM">
        <h2 className={styles.caption}>Wave RAM</h2>
        <p className={styles.mono}>{Array.from(memory.subarray(0xff30, 0xff40), hex2).join(' ')}</p>
      </section>
    </div>
  );
}

const paletteLabel = (value: number) =>
  'Colors 0–3 show shades ' + [0, 1, 2, 3].map((id) => (value >> (id * 2)) & 3).join(', ');
