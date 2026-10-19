import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Palette } from '@reactboy/core';
import type { ShellTheme } from '../../hooks/useSettings';
import { Board } from './Board';
import styles from './GameBoyShell.module.css';
import { PartCard } from './PartCard';
import { PARTS, type PartId } from './parts';
import { isClear } from './themes';

interface Props {
  /** CSS pixels per Game Boy pixel. */
  scale: number;
  theme: ShellTheme;
  /** The screen's colors, for pictures of video memory. */
  palette: Palette;
  powered: boolean;
  screen: ReactNode;
  dpad: ReactNode;
  actions: ReactNode;
  menu: ReactNode;
  /**
   * Where a part's explainer goes beside the device, when there is room for one. Without
   * it the explainer slides over the controls, below the screen.
   */
  cardSlot?: HTMLElement | null;
}

/**
 * The handheld body. Decorative parts are aria-hidden; only the screen and buttons are
 * exposed, plus, through a clear case, the board's parts as buttons that explain themselves.
 */
export function GameBoyShell({
  scale,
  theme,
  palette,
  powered,
  screen,
  dpad,
  actions,
  menu,
  cardSlot,
}: Props) {
  const clear = isClear(theme);
  const [selected, setSelected] = useState<PartId | null>(null);
  const hotspots = useRef(new Map<PartId, HTMLButtonElement>());
  const part = clear ? PARTS.find((p) => p.id === selected) : undefined;

  // Back to the part that was opened, so keyboard users keep their place.
  const close = useCallback(() => {
    if (selected) hotspots.current.get(selected)?.focus();
    setSelected(null);
  }, [selected]);

  return (
    <div
      className={styles.shell}
      data-theme={theme}
      data-clear={clear || undefined}
      style={{ '--u': `${scale}px` } as CSSProperties}
    >
      {clear && (
        <>
          <Board />
          <div className={styles.plastic} aria-hidden="true" />
        </>
      )}
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
      {clear && (
        <div className={styles.parts} role="group" aria-label="Parts inside the case">
          {PARTS.map(({ id, name, box }) => (
            <button
              key={id}
              ref={(button) => {
                if (button) hotspots.current.set(id, button);
                else hotspots.current.delete(id);
              }}
              type="button"
              className={styles.hotspot}
              data-part={id}
              aria-label={name}
              aria-expanded={selected === id}
              style={
                {
                  '--x': box.x,
                  '--y': box.y,
                  '--w': box.w,
                  '--h': box.h,
                } as CSSProperties
              }
              onClick={() => setSelected((current) => (current === id ? null : id))}
            />
          ))}
        </div>
      )}
      {part &&
        (cardSlot ? (
          createPortal(
            <PartCard part={part} palette={palette} placement="side" onClose={close} />,
            cardSlot,
          )
        ) : (
          <PartCard part={part} palette={palette} placement="sheet" onClose={close} />
        ))}
    </div>
  );
}
