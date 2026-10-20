import { useId, useRef, type CSSProperties } from 'react';
import { PALETTES, type PaletteName } from '@reactboy/core';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import type { Settings } from '../../hooks/useSettings';
import { isClear, SHELLS } from '../shell/themes';
import { GamepadBindings } from './GamepadBindings';
import { KeyBindings } from './KeyBindings';
import styles from './Panel.module.css';
import { RecentGames } from './RecentGames';
import { SaveSlots } from './SaveSlots';

const SPEEDS = [0.5, 1, 2, 4];
const CHANNELS = ['Pulse 1', 'Pulse 2', 'Wave', 'Noise'];
const PALETTE_NAMES: Record<PaletteName, string> = {
  classic: 'Original',
  grey: 'Pocket',
  mint: 'Mint',
  mono: 'Greyscale',
};

const kib = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024} MiB` : `${bytes / 1024} KiB`;

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onLoad: (file: File) => void;
  onDebugger: () => void;
  /** Starts the guided tour of a clear case's insides. */
  onTour: () => void;
  /** Focus the debugger button on mount, because the debugger just closed. */
  focusDebugger?: boolean;
}

export function Panel({ settings, onSettings, onLoad, onDebugger, onTour, focusDebugger }: Props) {
  const client = useEmulatorClient();
  const { status, header, error, fps, notice, sound, link } = useEmulatorState();
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const loaded = status === 'running' || status === 'paused';

  return (
    <aside className={styles.panel} aria-label="Emulator controls">
      <section className={styles.cartridge} aria-labelledby={`${id}-cart`}>
        <h1 id={`${id}-cart`} className={styles.title}>
          {header?.title ?? 'No cartridge'}
        </h1>
        {header ? (
          <p className={styles.meta}>
            {header.typeName}, {kib(header.romSize)} ROM
            {header.ramSize > 0 && `, ${kib(header.ramSize)} RAM`}
          </p>
        ) : (
          <p className={styles.meta}>
            Load a Game Boy ROM (.gb) from your device to start playing.
          </p>
        )}
        {header && !header.headerChecksumValid && (
          <p className={styles.warning}>
            The header checksum doesn’t match. The file may be damaged.
          </p>
        )}
        {error && loaded && <p className={styles.warning}>Couldn’t load that file. {error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}
        <div className={styles.row}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => fileInput.current?.click()}
          >
            {header ? 'Load another ROM' : 'Load ROM'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".gb,.gbc,.bin,application/octet-stream"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onLoad(file);
              event.target.value = '';
            }}
          />
        </div>
      </section>

      <section className={styles.section} aria-label="Playback">
        <div className={styles.row}>
          {status === 'off' ? (
            <button type="button" className={styles.button} onClick={() => client.setPower(true)}>
              Power on
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              disabled={!loaded}
              onClick={() => (status === 'running' ? client.pause() : client.play())}
            >
              {status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            disabled={!loaded}
            onClick={() => client.reset()}
          >
            Restart
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={status !== 'paused'}
            onClick={() => client.stepFrame()}
          >
            Next frame
          </button>
        </div>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Speed</legend>
          <div className={styles.segmented}>
            {SPEEDS.map((speed) => (
              <label key={speed} className={styles.segment}>
                <input
                  type="radio"
                  name={`${id}-speed`}
                  checked={settings.speed === speed}
                  onChange={() => onSettings({ speed })}
                />
                <span>{speed}×</span>
              </label>
            ))}
          </div>
        </fieldset>
        {status === 'off' && (
          <p className={styles.note}>
            Switched off. Turning it back on starts the game afresh; battery saves are kept.
          </p>
        )}
        {status === 'running' && (
          <p className={styles.fps} aria-hidden="true">
            {fps} fps
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby={`${id}-sound`}>
        <h2 id={`${id}-sound`} className={styles.heading}>
          Sound
        </h2>
        <div className={styles.volume}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={settings.muted}
            onClick={() => onSettings({ muted: !settings.muted })}
          >
            {settings.muted ? 'Unmute' : 'Mute'}
          </button>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.volume * 100)}
            disabled={settings.muted}
            aria-label="Volume"
            aria-valuetext={`${Math.round(settings.volume * 100)}%`}
            onChange={(event) => onSettings({ volume: Number(event.target.value) / 100 })}
          />
          <span className={styles.volumeValue} aria-hidden="true">
            {settings.muted ? 'Off' : `${Math.round(settings.volume * 100)}%`}
          </span>
        </div>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Channels</legend>
          <div className={styles.segmented}>
            {CHANNELS.map((name, i) => (
              <label key={name} className={styles.segment}>
                <input
                  type="checkbox"
                  checked={(settings.channels & (1 << i)) !== 0}
                  onChange={() => onSettings({ channels: settings.channels ^ (1 << i) })}
                />
                <span>{name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {sound === 'unavailable' ? (
          <p className={styles.note}>This browser can’t play the emulator’s sound.</p>
        ) : settings.speed !== 1 ? (
          <p className={styles.note}>Sound plays at 1× speed only.</p>
        ) : sound === 'locked' && loaded ? (
          <p className={styles.note}>Press a key or tap anywhere to turn sound on.</p>
        ) : null}
      </section>

      {header && loaded && <SaveSlots header={header} />}
      <RecentGames />

      <section className={styles.section} aria-label="Appearance">
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Screen colors</legend>
          <div className={styles.swatches}>
            {(Object.keys(PALETTES) as PaletteName[]).map((name) => (
              <label key={name} className={styles.swatch} title={PALETTE_NAMES[name]}>
                <input
                  type="radio"
                  name={`${id}-palette`}
                  checked={settings.palette === name}
                  onChange={() => onSettings({ palette: name })}
                />
                <span className={styles.paletteChip} aria-hidden="true">
                  {PALETTES[name].map((rgb) => (
                    <span
                      key={rgb}
                      style={{ background: `#${rgb.toString(16).padStart(6, '0')}` }}
                    />
                  ))}
                </span>
                <span className="visually-hidden">{PALETTE_NAMES[name]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Case color</legend>
          <div className={styles.swatches}>
            {SHELLS.map((shell) => (
              <label key={shell.id} className={styles.swatch} title={shell.name}>
                <input
                  type="radio"
                  name={`${id}-shell`}
                  checked={settings.shell === shell.id}
                  onChange={() => onSettings({ shell: shell.id })}
                />
                <span
                  className={styles.shellChip}
                  data-clear={shell.clear || undefined}
                  style={{ '--chip': shell.color } as CSSProperties}
                  aria-hidden="true"
                />
                <span className="visually-hidden">{shell.name}</span>
              </label>
            ))}
          </div>
          {isClear(settings.shell) && (
            <>
              <p className={styles.note}>
                See-through case: click or tap a chip on the board to see what it does.
              </p>
              <div className={styles.row}>
                <button type="button" className={styles.button} onClick={onTour}>
                  Take the tour
                </button>
              </div>
            </>
          )}
        </fieldset>
        <div className={styles.volume}>
          <label htmlFor={`${id}-contrast`} className={styles.legend}>
            Contrast
          </label>
          <input
            id={`${id}-contrast`}
            type="range"
            className={styles.slider}
            min={0}
            max={100}
            value={Math.round(settings.contrast * 100)}
            aria-valuetext={`${Math.round(settings.contrast * 100)}%`}
            onChange={(event) => onSettings({ contrast: Number(event.target.value) / 100 })}
          />
          <button
            type="button"
            className={styles.button}
            disabled={settings.contrast === 0.5}
            onClick={() => onSettings({ contrast: 0.5 })}
          >
            Reset
          </button>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={`${id}-link`}>
        <h2 id={`${id}-link`} className={styles.heading}>
          Link cable
        </h2>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={link !== 'off'}
            onClick={() => client.setLink(link === 'off')}
          >
            {link === 'off' ? 'Connect cable' : 'Disconnect cable'}
          </button>
        </div>
        <p className={styles.note}>
          {link === 'off'
            ? 'Trade and play two-player games with another ReactBoy window on this device.'
            : link === 'waiting'
              ? 'Waiting for another window: open ReactBoy in a second window and connect its cable too.'
              : 'Connected to another window. Keep both in view: a hidden window pauses its game.'}
        </p>
      </section>

      <section className={styles.section} aria-labelledby={`${id}-keys`}>
        <h2 id={`${id}-keys`} className={styles.heading}>
          Keyboard
        </h2>
        <KeyBindings keymap={settings.keymap} onChange={(keymap) => onSettings({ keymap })} />
      </section>

      <section className={styles.section} aria-labelledby={`${id}-pad`}>
        <h2 id={`${id}-pad`} className={styles.heading}>
          Controller
        </h2>
        <GamepadBindings padmap={settings.padmap} onChange={(padmap) => onSettings({ padmap })} />
      </section>

      <section className={styles.section} aria-labelledby={`${id}-dev`}>
        <h2 id={`${id}-dev`} className={styles.heading}>
          Developer tools
        </h2>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            autoFocus={focusDebugger}
            onClick={onDebugger}
          >
            Open debugger
          </button>
        </div>
        <p className={styles.note}>
          Step through the game’s code and inspect its memory, tiles, sprites and registers.
        </p>
      </section>

      <footer className={styles.footer}>
        <p>ROMs stay on your device; nothing is uploaded.</p>
        <p>
          <a href="https://github.com/jraleman/ReactBoy">Source on GitHub</a>
        </p>
      </footer>
    </aside>
  );
}
