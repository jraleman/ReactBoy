import type { CSSProperties, ReactNode } from 'react';
import type { ShellTheme } from '../../hooks/useSettings';
import styles from './GameBoyShell.module.css';

interface Props {
  /** CSS pixels per Game Boy pixel. */
  scale: number;
  theme: ShellTheme;
  powered: boolean;
  screen: ReactNode;
  dpad: ReactNode;
  actions: ReactNode;
  menu: ReactNode;
}

/** The handheld body. Decorative parts are aria-hidden; only the screen and buttons are exposed. */
export function GameBoyShell({ scale, theme, powered, screen, dpad, actions, menu }: Props) {
  return (
    <div
      className={styles.shell}
      data-theme={theme}
      style={{ '--u': `${scale}px` } as CSSProperties}
    >
      <div className={styles.seam} aria-hidden="true" />
      <span className={styles.switchLabel} aria-hidden="true">
        ◂ OFF · ON ▸
      </span>
      <div className={styles.bezel}>
        <div className={styles.stripes} aria-hidden="true" />
        <span className={styles.led} data-on={powered || undefined} aria-hidden="true" />
        <span className={styles.ledLabel} aria-hidden="true">
          POWER
        </span>
        <div className={styles.lcd}>{screen}</div>
      </div>
      <p className={styles.wordmark} aria-hidden="true">
        ReactBoy<sup>DMG</sup>
      </p>
      <div className={styles.dpad}>{dpad}</div>
      <div className={styles.actions}>{actions}</div>
      <div className={styles.menu}>{menu}</div>
      <div className={styles.speaker} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    </div>
  );
}
