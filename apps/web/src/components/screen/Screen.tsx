import { useCallback, type CSSProperties } from 'react';
import type { Palette } from '@reactboy/core';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@reactboy/core';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import styles from './Screen.module.css';

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

export function Screen({ palette }: { palette: Palette }) {
  const client = useEmulatorClient();
  const { status, error, header } = useEmulatorState();
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => client.attachCanvas(canvas),
    [client],
  );

  const lcdColors = Object.fromEntries(
    palette.map((rgb, i) => [`--lcd-${i}`, hex(rgb)]),
  ) as CSSProperties;
  const showGame = status === 'running' || status === 'paused';

  return (
    <div className={styles.screen} style={lcdColors}>
      <canvas
        ref={attach}
        className={styles.canvas}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        hidden={!showGame}
        role="img"
        aria-label={header ? `${header.title} game screen` : 'Game screen'}
      />
      {status === 'empty' && (
        <div className={styles.overlay}>
          <p className={styles.logo} aria-hidden="true">
            ReactBoy
          </p>
          <p className={styles.hint}>Drop a .gb file here, or choose Load ROM.</p>
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
