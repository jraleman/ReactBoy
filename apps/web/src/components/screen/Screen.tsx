import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { Palette } from '@reactboy/core';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@reactboy/core';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import { REDUCED_MOTION, useMediaQuery } from '../../hooks/useMediaQuery';
import styles from './Screen.module.css';

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** When the wordmark lands and the boot ends; matches .boot[data-power] in Screen.module.css. */
const CHIME_MS = 1150;
const BOOT_MS = 1650;

/** The React atom over the wordmark, as the boot screen shows them. */
function BootLogo() {
  return (
    <div className={styles.bootLogo} aria-hidden="true">
      <svg className={styles.atom} viewBox="-11.5 -10.23 23 20.46">
        {[0, 60, 120].map((angle, i) => (
          <ellipse
            key={angle}
            className={styles.orbit}
            rx={11}
            ry={4.2}
            transform={`rotate(${angle})`}
            pathLength={1}
            style={{ '--order': i } as CSSProperties}
          />
        ))}
        <circle className={styles.nucleus} r={2.05} />
      </svg>
      <p className={styles.logo}>ReactBoy</p>
    </div>
  );
}

export function Screen({ palette, intro = false }: { palette: Palette; intro?: boolean }) {
  const client = useEmulatorClient();
  const { status, error, header, gameId } = useEmulatorState();
  const reduced = useMediaQuery(REDUCED_MOTION);
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => client.attachCanvas(canvas),
    [client],
  );

  // A game starting afresh (switched on, or a new cartridge) boots behind the logo, as the
  // hardware does; resuming from a pause doesn't. Counted so a second boot restarts it.
  const [seen, setSeen] = useState({ status, gameId });
  const [boot, setBoot] = useState<number | null>(null);
  if (status !== seen.status || gameId !== seen.gameId) {
    setSeen({ status, gameId });
    const wasOn = seen.status === 'running' || seen.status === 'paused';
    if (status === 'running' && (!wasOn || gameId !== seen.gameId) && !intro && !reduced) {
      setBoot((count) => (count ?? 0) + 1);
    } else if (status !== 'running' && status !== 'paused') {
      setBoot(null);
    }
  }

  useEffect(() => {
    if (boot === null) return;
    const chime = setTimeout(() => client.chime(), CHIME_MS);
    const done = setTimeout(() => setBoot(null), BOOT_MS);
    return () => {
      clearTimeout(chime);
      clearTimeout(done);
    };
  }, [boot, client]);

  const lcdColors = Object.fromEntries(
    palette.map((rgb, i) => [`--lcd-${i}`, hex(rgb)]),
  ) as CSSProperties;
  const showGame = status === 'running' || status === 'paused';
  const showBoot = status === 'empty' || (showGame && (intro || boot !== null));

  return (
    <div className={styles.screen} style={lcdColors} data-off={status === 'off' || undefined}>
      <canvas
        ref={attach}
        className={styles.canvas}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        hidden={!showGame}
        role="img"
        aria-label={header ? `${header.title} game screen` : 'Game screen'}
      />
      {showBoot && (
        <div key={boot} className={styles.boot} data-power={boot !== null || undefined}>
          <BootLogo />
          {status === 'empty' && (
            <p className={styles.hint}>Drop a .gb file here, or choose Load ROM.</p>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className={styles.overlay} role="alert">
          <p className={styles.errorTitle}>Can’t play this file</p>
          <p className={styles.error}>{error}</p>
        </div>
      )}
    </div>
  );
}
