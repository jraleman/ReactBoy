import { useId, useRef, useState, type MouseEvent } from 'react';
import type { DebugSnapshot, Watchpoint } from '@reactboy/core';
import { useDebugState, useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import panel from '../panel/Panel.module.css';
import { AddressForm } from './AddressForm';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { hex2, hex4, REGIONS, regionOf } from './hex';

const ROW_HEIGHT = 22;
const ROWS = 0x10000 / 16;
/** Rows drawn beyond the visible ones, so fast scrolling doesn't show gaps. */
const OVERSCAN = 6;
/** Matches .hexScroll's height. */
const VIEWPORT = 22 * ROW_HEIGHT;

const ascii = (byte: number) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.');

/** ROM and the unusable area can't be edited (see GameBoy.poke). */
const editable = (addr: number) => addr >= 0x8000 && (addr < 0xfea0 || addr >= 0xff00);

/** Parses a byte typed as 3F, $3F or 0x3F. */
const parseByte = (text: string) => {
  const digits = text.trim().replace(/^(\$|0x)/i, '');
  return /^[0-9a-f]{1,2}$/i.test(digits) ? parseInt(digits, 16) : null;
};

/** A hex view of the whole address space; only the visible rows are rendered. */
export function MemoryView({ snapshot, previous, symbols }: ViewProps) {
  const client = useEmulatorClient();
  const { status } = useEmulatorState();
  const { watchpoints } = useDebugState();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const { memory } = snapshot;
  const before = previous?.memory;
  const watchedSet = new Set(watchpoints.map((w) => w.addr));

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(ROWS, Math.ceil((scrollTop + VIEWPORT) / ROW_HEIGHT) + OVERSCAN);

  const goTo = (addr: number) => {
    setSelected(addr);
    const top = Math.floor(addr / 16) * ROW_HEIGHT;
    if (scroller.current) scroller.current.scrollTop = top - ROW_HEIGHT * 2;
  };

  const select = (event: MouseEvent) => {
    const addr = (event.target as HTMLElement).dataset.addr;
    if (addr !== undefined) setSelected(Number(addr));
  };

  const value = selected !== null ? memory[selected]! : 0;
  const label = selected !== null && symbols?.labelAt(selected, snapshot.romBank);

  return (
    <div className={styles.memory}>
      <div className={styles.viewBar}>
        <AddressForm
          label="Go to address"
          action="Go"
          symbols={symbols}
          onSubmit={({ addr }) => goTo(addr)}
        />
        <div className={styles.regions}>
          {REGIONS.filter((r) => r.name !== 'Unused' && r.name !== 'Echo').map((region) => (
            <button
              key={region.name}
              type="button"
              className={styles.chip}
              title={region.label}
              onClick={() => goTo(region.start)}
            >
              {region.name}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scroller}
        className={styles.hexScroll}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        role="region"
        aria-label="Memory"
        tabIndex={0}
      >
        <div className={styles.hexBody} style={{ height: ROWS * ROW_HEIGHT }} onClick={select}>
          {Array.from({ length: last - first }, (_, i) => {
            const row = first + i;
            const base = row * 16;
            const bytes = memory.subarray(base, base + 16);
            return (
              <div
                key={row}
                className={styles.hexRow}
                style={{ transform: `translateY(${row * ROW_HEIGHT}px)` }}
              >
                <span className={styles.addr}>{hex4(base)}</span>
                <span className={styles.hexBytes}>
                  {Array.from(bytes, (byte, col) => {
                    const addr = base + col;
                    return (
                      <span
                        key={col}
                        data-addr={addr}
                        data-changed={(before && before[addr] !== byte) || undefined}
                        data-selected={addr === selected || undefined}
                        data-watched={watchedSet.has(addr) || undefined}
                      >
                        {hex2(byte)}
                      </span>
                    );
                  })}
                </span>
                <span className={styles.ascii} aria-hidden="true">
                  {Array.from(bytes, ascii).join('')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {selected === null ? (
        <p className={styles.small}>
          Select a byte to see, edit or watch it. Changed bytes are highlighted.
        </p>
      ) : (
        <div className={styles.selection}>
          <p>
            <span className={styles.mono}>${hex4(selected)}</span>
            {label && <span className={styles.mono}> {label}</span>} ={' '}
            <span className={styles.mono}>${hex2(value)}</span> ({value}, %
            {value.toString(2).padStart(8, '0')}) · {regionOf(selected).label}
          </p>
          <WatchToggles
            addr={selected}
            watchpoints={watchpoints}
            onChange={(list) => client.setWatchpoints(list)}
          />
          <ByteEditor
            key={selected}
            addr={selected}
            snapshot={snapshot}
            paused={status === 'paused'}
            onSubmit={(next) => client.poke(selected, next)}
          />
        </div>
      )}
    </div>
  );
}

interface WatchTogglesProps {
  addr: number;
  watchpoints: Watchpoint[];
  onChange: (watchpoints: Watchpoint[]) => void;
}

/** Stop on reads and/or writes of the selected byte. */
function WatchToggles({ addr, watchpoints, onChange }: WatchTogglesProps) {
  const current = watchpoints.find((w) => w.addr === addr);
  const toggle = (access: 'read' | 'write') => {
    const next = { addr, read: false, write: false, ...current, [access]: !current?.[access] };
    const others = watchpoints.filter((w) => w !== current);
    onChange(next.read || next.write ? [...others, next] : others);
  };
  return (
    <div className={styles.access}>
      {(['read', 'write'] as const).map((access) => (
        <button
          key={access}
          type="button"
          className={`${panel.small} ${styles.fit}`}
          aria-pressed={current?.[access] ?? false}
          onClick={() => toggle(access)}
        >
          Stop on {access}
        </button>
      ))}
    </div>
  );
}

interface ByteEditorProps {
  addr: number;
  snapshot: DebugSnapshot;
  paused: boolean;
  onSubmit: (value: number) => void;
}

/** Sets the selected byte while paused, and says so if the hardware didn't keep it. */
function ByteEditor({ addr, snapshot, paused, onSubmit }: ByteEditorProps) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  /** A write waiting for the inspection that follows it. */
  const [pending, setPending] = useState<{ value: number; before: DebugSnapshot } | null>(null);
  const [message, setMessage] = useState('');
  const id = useId();

  if (pending && snapshot !== pending.before) {
    const value = snapshot.memory[addr]!;
    setPending(null);
    setMessage(
      value === pending.value
        ? `Set to $${hex2(value)}.`
        : `Wrote $${hex2(pending.value)}, but it reads $${hex2(value)}: the hardware ignores some writes here.`,
    );
  }

  if (!editable(addr)) {
    return <p className={styles.small}>ROM can’t be edited.</p>;
  }
  return (
    <form
      className={styles.addressForm}
      onSubmit={(event) => {
        event.preventDefault();
        const next = parseByte(text);
        setInvalid(next === null);
        if (next === null) return;
        setPending({ value: next, before: snapshot });
        setText('');
        onSubmit(next);
      }}
    >
      <input
        className={styles.byteInput}
        value={text}
        placeholder={hex2(snapshot.memory[addr]!)}
        aria-label={`New value for $${hex4(addr)}`}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-note`}
        disabled={!paused}
        spellCheck={false}
        autoComplete="off"
        maxLength={4}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
      />
      <button type="submit" className={`${panel.small} ${styles.fit}`} disabled={!paused}>
        Set
      </button>
      <span id={`${id}-note`} className={invalid ? styles.error : styles.small} aria-live="polite">
        {!paused ? 'Pause to edit.' : invalid ? 'Enter a hex byte, 00 to FF.' : message}
      </span>
    </form>
  );
}
