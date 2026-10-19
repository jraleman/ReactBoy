import { lazy, Suspense, useCallback, useEffect, useState, type DragEvent } from 'react';
import { PALETTES, type ButtonId } from '@reactboy/core';
import styles from './App.module.css';
import { ActionButtons } from './components/controls/ActionButtons';
import { DPad } from './components/controls/DPad';
import { StartSelect } from './components/controls/StartSelect';
import { Panel } from './components/panel/Panel';
import { Screen } from './components/screen/Screen';
import { GameBoyShell } from './components/shell/GameBoyShell';
import { UpdateBanner } from './components/update/UpdateBanner';
import { useDeviceScale, WIDE_QUERY } from './hooks/useDeviceScale';
import { useEmulatorClient, useEmulatorState } from './hooks/useEmulator';
import { useKeyboard } from './hooks/useKeyboard';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useSettings } from './hooks/useSettings';
import { useShortcuts } from './hooks/useShortcuts';

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

// Developer tools stay out of the main bundle until someone opens them.
const Debugger = lazy(() => import('./components/debugger/Debugger'));

export function App() {
  const client = useEmulatorClient();
  const { status, header, pressed, notice } = useEmulatorState();
  const [settings, updateSettings] = useSettings();
  const scale = useDeviceScale();
  const wide = useMediaQuery(WIDE_QUERY);
  /** Beside the device on wide layouts: where a clear case's part explainer goes. */
  const [cardSlot, setCardSlot] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Where focus goes when the debugger opens or closes, so it isn't lost with the panel. */
  const [debuggerToggled, setDebuggerToggled] = useState(false);
  const palette = PALETTES[settings.palette] ?? PALETTES.classic;

  useKeyboard(client, settings.keymap);
  useShortcuts(client);
  useEffect(() => client.setPalette(palette), [client, palette]);
  useEffect(() => client.setSpeed(settings.speed), [client, settings.speed]);
  useEffect(() => client.setGamepadMap(settings.padmap), [client, settings.padmap]);
  const { volume, muted, channels } = settings;
  useEffect(() => client.setAudio({ volume, muted, channels }), [client, volume, muted, channels]);
  useEffect(() => {
    // Any gesture may start sound; later ones resume it if the system suspended it.
    const unlock = () => client.unlockAudio();
    const options = { capture: true, passive: true };
    window.addEventListener('pointerdown', unlock, options);
    window.addEventListener('keydown', unlock, options);
    return () => {
      window.removeEventListener('pointerdown', unlock, options);
      window.removeEventListener('keydown', unlock, options);
    };
  }, [client]);
  useEffect(() => {
    // Hidden is the last event mobile browsers reliably deliver before discarding a tab.
    const save = () => {
      if (document.visibilityState === 'hidden') void client.persist();
    };
    document.addEventListener('visibilitychange', save);
    return () => document.removeEventListener('visibilitychange', save);
  }, [client]);

  const onTouch = useCallback(
    (button: ButtonId, down: boolean) => client.setButton('touch', button, down),
    [client],
  );
  const load = useCallback((file: File) => void client.loadRom(file), [client]);

  return (
    <main
      className={styles.app}
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) load(file);
      }}
    >
      <div className={styles.device}>
        <GameBoyShell
          scale={scale}
          theme={settings.shell}
          palette={palette}
          powered={status === 'running' || status === 'paused'}
          screen={<Screen palette={palette} />}
          dpad={<DPad onButton={onTouch} pressed={pressed} />}
          actions={<ActionButtons onButton={onTouch} pressed={pressed} />}
          menu={<StartSelect onButton={onTouch} pressed={pressed} />}
          cardSlot={wide ? cardSlot : null}
        />
      </div>
      <div className={styles.side} data-debugger={settings.debugger || undefined}>
        {wide && <div ref={setCardSlot} className={styles.cardSlot} />}
        {settings.debugger ? (
          <Suspense fallback={<p className={styles.loading}>Loading the debugger…</p>}>
            <Debugger
              palette={palette}
              autoFocus={debuggerToggled}
              onClose={() => {
                setDebuggerToggled(true);
                updateSettings({ debugger: false });
              }}
            />
          </Suspense>
        ) : (
          <Panel
            settings={settings}
            onSettings={updateSettings}
            onLoad={load}
            focusDebugger={debuggerToggled}
            onDebugger={() => {
              setDebuggerToggled(true);
              updateSettings({ debugger: true });
            }}
          />
        )}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {status === 'running' && header ? `Playing ${header.title}` : ''}
        {status === 'paused' ? 'Paused' : ''}
        {notice ? ` ${notice}` : ''}
      </p>
      <UpdateBanner />
      {dragging && (
        <div className={styles.dropHint} aria-hidden="true">
          Drop to load the ROM
        </div>
      )}
    </main>
  );
}
