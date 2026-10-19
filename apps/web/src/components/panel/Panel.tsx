import { useId, useRef } from 'react';
import { PALETTES, type PaletteName } from '@reactboy/core';
import { useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import type { Settings, ShellTheme } from '../../hooks/useSettings';
import { BUTTON_LABELS, DEFAULT_KEYMAP } from '../../input/buttons';
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
const SHELLS: { id: ShellTheme; name: string; color: string }[] = [
  { id: 'grey', name: 'Grey', color: '#c5c1bb' },
  { id: 'purple', name: 'Purple', color: '#6a4c9c' },
  { id: 'teal', name: 'Teal', color: '#2e8b86' },
  { id: 'yellow', name: 'Yellow', color: '#f0c02e' },
];

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  KeyX: 'X',
  KeyZ: 'Z',
  Enter: 'Enter',
  Backspace: 'Backspace',
  ShiftRight: 'Right Shift',
};

const kib = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024} MiB` : `${bytes / 1024} KiB`;

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onLoad: (file: File) => void;
}

export function Panel({ settings, onSettings, onLoad }: Props) {
  const client = useEmulatorClient();
  const { status, header, error, fps, notice, sound } = useEmulatorState();
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const loaded = status === 'running' || status === 'paused';

  // Group keys by button for the help table: "Select: Backspace or Right Shift".
  const keysByButton = new Map<string, string[]>();
  for (const [code, button] of Object.entries(DEFAULT_KEYMAP)) {
    const label = BUTTON_LABELS[button];
    keysByButton.set(label, [...(keysByButton.get(label) ?? []), KEY_NAMES[code] ?? code]);
  }

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
          <button
            type="button"
            className={styles.button}
            disabled={!loaded}
            onClick={() => (status === 'running' ? client.pause() : client.play())}
          >
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
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
                  style={{ background: shell.color }}
                  aria-hidden="true"
                />
                <span className="visually-hidden">{shell.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={styles.section} aria-labelledby={`${id}-keys`}>
        <h2 id={`${id}-keys`} className={styles.heading}>
          Keyboard
        </h2>
        <dl className={styles.keys}>
          {[...keysByButton].map(([button, keys]) => (
            <div key={button} className={styles.keyRow}>
              <dt>{button}</dt>
              <dd>
                {keys.map((key, i) => (
                  <span key={key}>
                    {i > 0 && ' or '}
                    <kbd>{key}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.note}>Gamepads work too: connect one and press any button.</p>
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
