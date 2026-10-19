import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { PALETTES, type ButtonId } from '@reactboy/core';
import styles from './App.module.css';
import { ActionButtons } from './components/controls/ActionButtons';
import { DPad } from './components/controls/DPad';
import { StartSelect } from './components/controls/StartSelect';
import { Panel } from './components/panel/Panel';
import { Screen } from './components/screen/Screen';
import { GameBoyShell } from './components/shell/GameBoyShell';
import { useDeviceScale } from './hooks/useDeviceScale';
import { useEmulatorClient, useEmulatorState } from './hooks/useEmulator';
import { useKeyboard } from './hooks/useKeyboard';
import { useSettings } from './hooks/useSettings';
import { DEFAULT_KEYMAP } from './input/buttons';

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

export function App() {
  const client = useEmulatorClient();
  const { status, header, pressed } = useEmulatorState();
  const [settings, updateSettings] = useSettings();
  const scale = useDeviceScale();
  const [dragging, setDragging] = useState(false);
  const palette = PALETTES[settings.palette] ?? PALETTES.classic;

  useKeyboard(client, DEFAULT_KEYMAP);
  useEffect(() => client.setPalette(palette), [client, palette]);
  useEffect(() => client.setSpeed(settings.speed), [client, settings.speed]);

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
          powered={status === 'running' || status === 'paused'}
          screen={<Screen palette={palette} />}
          dpad={<DPad onButton={onTouch} pressed={pressed} />}
          actions={<ActionButtons onButton={onTouch} pressed={pressed} />}
          menu={<StartSelect onButton={onTouch} pressed={pressed} />}
        />
      </div>
      <Panel settings={settings} onSettings={updateSettings} onLoad={load} />
      <p className="visually-hidden" role="status" aria-live="polite">
        {status === 'running' && header ? `Playing ${header.title}` : ''}
        {status === 'paused' ? 'Paused' : ''}
      </p>
      {dragging && (
        <div className={styles.dropHint} aria-hidden="true">
          Drop to load the ROM
        </div>
      )}
    </main>
  );
}
