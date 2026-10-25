import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ColorCorrection, DebugSnapshot, Palette } from '@reactboy/core';
import { useDebugState, useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import { describeStop } from '../../worker/client';
import panel from '../panel/Panel.module.css';
import { CpuView } from './CpuView';
import styles from './Debugger.module.css';
import { hex4 } from './hex';
import { IoView } from './IoView';
import { MapView } from './MapView';
import { MemoryView } from './MemoryView';
import { PaletteView } from './PaletteView';
import { SpriteView } from './SpriteView';
import { parseSymbols, type SymbolTable } from './symbols';
import { SymbolsBar } from './SymbolsBar';
import { TileView } from './TileView';

const TABS = [
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'map', label: 'Background' },
  { id: 'sprites', label: 'Sprites' },
  { id: 'palettes', label: 'Palettes', color: true },
  { id: 'io', label: 'I/O' },
] as const;

type TabId = (typeof TABS)[number]['id'];
/** Without Game Boy Color palette RAM to show. */
const DMG_TABS = TABS.filter((t) => !('color' in t));

export interface ViewProps {
  snapshot: DebugSnapshot;
  /** The inspection before `snapshot`, to highlight changes. */
  previous: DebugSnapshot | null;
  /** The screen's shades, for DMG palettes and raw tile data. */
  palette: Palette;
  /** How Game Boy Color palette RAM is shown. */
  correction: ColorCorrection;
  /** Labels from the game's symbol file, if one was loaded. */
  symbols: SymbolTable | null;
}

interface Props {
  palette: Palette;
  correction: ColorCorrection;
  /** Move focus to the debugger when it appears (it was opened, not restored). */
  autoFocus?: boolean;
  onClose: () => void;
}

/**
 * Developer tools: CPU state and disassembly with breakpoints and stepping, plus memory,
 * VRAM, sprite and register viewers. Loaded on demand; arms the emulator's debugger while
 * mounted.
 */
export default function Debugger({ palette, correction, autoFocus = false, onClose }: Props) {
  const client = useEmulatorClient();
  const { status, header, model } = useEmulatorState();
  const { snapshot, previous, stop, stepping, symbols: stored } = useDebugState();
  const symbols = useMemo(() => stored && parseSymbols(stored.text), [stored]);
  const [chosenTab, setTab] = useState<TabId>('cpu');
  const tabs: readonly (typeof TABS)[number][] = model === 'cgb' ? TABS : DMG_TABS;
  // A tab can go when the game does; coming back to one with it brings it back.
  const tab = tabs.some((t) => t.id === chosenTab) ? chosenTab : 'cpu';
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const loaded = status === 'running' || status === 'paused';
  const paused = status === 'paused';

  useEffect(() => {
    client.setDebuggerOpen(true);
    return () => client.setDebuggerOpen(false);
  }, [client]);
  useEffect(() => {
    if (autoFocus) heading.current?.focus();
  }, [autoFocus]);

  const onTabKey = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const wrapped = (next + tabs.length) % tabs.length;
    setTab(tabs[wrapped]!.id);
    tabRefs.current[wrapped]?.focus();
  };

  let state = 'Load a ROM to inspect it.';
  if (status === 'running') state = stepping ? 'Running until the step finishes…' : 'Running';
  else if (paused && stop) state = describeStop(stop);
  else if (paused && snapshot) state = `Paused at $${hex4(snapshot.pc)}.`;

  const view = snapshot && { snapshot, previous, palette, correction, symbols };

  return (
    <section className={styles.debugger} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h1 ref={heading} id={`${id}-title`} className={styles.title} tabIndex={-1}>
            Debugger
          </h1>
          {header && <p className={styles.small}>{header.title}</p>}
        </div>
        <button type="button" className={panel.button} onClick={onClose}>
          Close
        </button>
      </header>

      <div className={styles.toolbar} role="toolbar" aria-label="Execution">
        <button
          type="button"
          className={panel.primary}
          disabled={!loaded}
          onClick={() => (status === 'running' ? client.pause() : client.play())}
        >
          {status === 'running' ? 'Pause' : 'Continue'}
        </button>
        <button
          type="button"
          className={panel.button}
          disabled={!paused}
          title="Run one instruction"
          onClick={() => client.debugStep('into')}
        >
          Step
        </button>
        <button
          type="button"
          className={panel.button}
          disabled={!paused}
          title="Run one instruction, or a whole CALL or RST"
          onClick={() => client.debugStep('over')}
        >
          Step over
        </button>
        <button
          type="button"
          className={panel.button}
          disabled={!paused}
          title="Run until the current routine returns"
          onClick={() => client.debugStep('out')}
        >
          Step out
        </button>
        <button
          type="button"
          className={panel.button}
          disabled={!paused}
          title="Run to the end of the frame"
          onClick={() => client.stepFrame()}
        >
          Frame
        </button>
      </div>
      <p className={styles.state}>
        <span>{state}</span>
        {snapshot && (
          <span className={styles.counters}>
            Frame {snapshot.frame.toLocaleString('en')} · ROM bank {snapshot.romBank}
          </span>
        )}
      </p>
      {loaded && <SymbolsBar stored={stored} symbols={symbols} />}

      <div className={styles.tabs} role="tablist" aria-label="Views">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className={styles.tab}
            onClick={() => setTab(t.id)}
            onKeyDown={(event) => onTabKey(event, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        className={styles.view}
      >
        {!view ? (
          <p className={panel.note}>
            {loaded ? 'Waiting for the emulator…' : 'Nothing to inspect yet.'}
          </p>
        ) : tab === 'cpu' ? (
          <CpuView {...view} />
        ) : tab === 'memory' ? (
          <MemoryView {...view} />
        ) : tab === 'tiles' ? (
          <TileView {...view} />
        ) : tab === 'map' ? (
          <MapView {...view} />
        ) : tab === 'sprites' ? (
          <SpriteView {...view} />
        ) : tab === 'palettes' ? (
          <PaletteView {...view} />
        ) : (
          <IoView {...view} />
        )}
      </div>
    </section>
  );
}
