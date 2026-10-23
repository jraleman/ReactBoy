import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Palette } from '@reactboy/core';
import type { ShellTheme } from '../../hooks/useSettings';
import { Board } from './Board';
import styles from './GameBoyShell.module.css';
import { LiveBoard } from './LiveBoard';
import { PartCard } from './PartCard';
import { PARTS, type PartId } from './parts';
import { TOUR, type PartsView } from './partsView';
import { isClear } from './themes';

interface Props {
  /** CSS pixels per Game Boy pixel. */
  scale: number;
  theme: ShellTheme;
  /** The screen's colors, for pictures of video memory. */
  palette: Palette;
  /** The power LED is lit and the switch is on. */
  powered: boolean;
  /** The switch can be used: there is a game to power. */
  canPower: boolean;
  onPower: (on: boolean) => void;
  /** The contrast wheel, 0-1. */
  contrast: number;
  onContrast: (contrast: number) => void;
  /** What a clear case has open; see usePartsView. */
  view: PartsView;
  screen: ReactNode;
  dpad: ReactNode;
  actions: ReactNode;
  menu: ReactNode;
  /**
   * Where a part's explainer goes beside the device, when there is room for one. Without
   * it the explainer slides over the controls, below the screen.
   */
  cardSlot?: HTMLElement | null;
  /** The device is coming together on load; see useIntro. */
  intro?: boolean;
}

/**
 * How the wheel changes the LCD: low contrast washes pixels out, high darkens them, and the
 * middle shows the palette as it is.
 */
const lcdFilter = (contrast: number) =>
  contrast === 0.5
    ? undefined
    : `contrast(${(0.55 + 0.9 * contrast).toFixed(3)}) brightness(${(1.15 - 0.3 * contrast).toFixed(3)})`;

/**
 * The handheld body. Decorative parts are aria-hidden; the screen, buttons, power switch and
 * contrast wheel are exposed, plus, through a clear case, the board's parts as buttons that
 * explain themselves.
 */
export function GameBoyShell({
  scale,
  theme,
  palette,
  powered,
  canPower,
  onPower,
  contrast,
  onContrast,
  view,
  screen,
  dpad,
  actions,
  menu,
  cardSlot,
  intro = false,
}: Props) {
  const clear = isClear(theme);
  const hotspots = useRef(new Map<PartId, HTMLButtonElement>());
  const part = clear ? PARTS.find((p) => p.id === view.selected) : undefined;
  const { selected, close: closeView } = view;

  // Back to the part that was opened, so keyboard users keep their place.
  const close = useCallback(() => {
    if (selected) hotspots.current.get(selected)?.focus();
    closeView();
  }, [selected, closeView]);

  const tour =
    part && view.step !== null
      ? {
          step: view.step,
          total: TOUR.length,
          story: TOUR[view.step]!.story,
          onStep: view.goTo,
        }
      : undefined;
  const card = (placement: 'side' | 'sheet') =>
    part && (
      <PartCard
        key={part.id}
        part={part}
        palette={palette}
        placement={placement}
        tour={tour}
        onClose={close}
      />
    );

  return (
    <div
      className={styles.shell}
      data-theme={theme}
      data-clear={clear || undefined}
      data-intro={intro || undefined}
      style={{ '--u': `${scale}px` } as CSSProperties}
    >
      {clear ? (
        <>
          <LiveBoard />
          <div className={styles.plastic} aria-hidden="true" />
        </>
      ) : (
        intro && (
          <>
            <Board />
            <div className={styles.casing} aria-hidden="true" />
          </>
        )
      )}
      <div className={styles.seam} aria-hidden="true" />
      <span className={styles.switchLabel} aria-hidden="true">
        ◂ OFF · ON ▸
      </span>
      <button
        type="button"
        role="switch"
        className={styles.powerSwitch}
        aria-label="Power"
        aria-checked={powered}
        disabled={!canPower}
        onClick={() => onPower(!powered)}
      />
      <input
        type="range"
        className={styles.contrast}
        min={0}
        max={100}
        value={Math.round(contrast * 100)}
        aria-label="Contrast wheel"
        aria-valuetext={`${Math.round(contrast * 100)}%`}
        style={{ '--turn': contrast } as CSSProperties}
        onChange={(event) => onContrast(Number(event.target.value) / 100)}
      />
      <div className={styles.bezel}>
        <div className={styles.stripes} aria-hidden="true" />
        <span className={styles.led} data-on={powered || undefined} aria-hidden="true" />
        <span className={styles.ledLabel} aria-hidden="true">
          POWER
        </span>
        <div className={styles.lcd} style={{ filter: lcdFilter(contrast) }}>
          {screen}
        </div>
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
              onClick={() => view.toggle(id)}
            />
          ))}
        </div>
      )}
      {cardSlot ? part && createPortal(card('side'), cardSlot) : card('sheet')}
    </div>
  );
}
