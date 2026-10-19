import { Fragment, useState, type ReactNode } from 'react';
import type { Breakpoint, Watchpoint } from '@reactboy/core';
import { useDebugState, useEmulatorClient } from '../../hooks/useEmulator';
import panel from '../panel/Panel.module.css';
import { AddressForm } from './AddressForm';
import type { ViewProps } from './Debugger';
import styles from './Debugger.module.css';
import { disassembleAround } from './disassembly';
import { hex2, hex4 } from './hex';
import { INTERRUPT_NAMES } from './io-registers';
import {
  formatLocation,
  isBanked,
  labelOperands,
  matchesBank,
  type Location,
  type SymbolTable,
} from './symbols';

const PAIRS = ['af', 'bc', 'de', 'hl', 'sp', 'pc'] as const;
const FLAGS = [
  ['Z', 0x80, 'Zero'],
  ['N', 0x40, 'Subtract'],
  ['H', 0x20, 'Half carry'],
  ['C', 0x10, 'Carry'],
] as const;
const STACK_WORDS = 8;

export function CpuView({ snapshot, previous, symbols }: ViewProps) {
  const client = useEmulatorClient();
  const { breakpoints, watchpoints } = useDebugState();
  /** Where the disassembly is centred; null follows PC. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const { memory, pc, sp, romBank } = snapshot;
  const f = snapshot.af & 0xff;
  const ie = memory[0xffff]!;
  const iflag = memory[0xff0f]!;
  const lines = disassembleAround(memory, anchor ?? pc, 8, 24);

  /** Breakpoints that apply to `addr` with the current bank mapped. */
  const armedAt = (addr: number) =>
    breakpoints.filter((b) => b.addr === addr && matchesBank(location(b), romBank));
  /** In switchable ROM, a breakpoint set from the disassembly is for the bank shown. */
  const toggleBreakpoint = (addr: number) => {
    const armed = armedAt(addr);
    client.setBreakpoints(
      armed.length > 0
        ? breakpoints.filter((b) => !armed.includes(b))
        : [...breakpoints, { addr, bank: isBanked(addr) ? romBank : null }],
    );
  };

  return (
    <div className={styles.cpu}>
      <div className={styles.cpuSide}>
        <dl className={styles.registers} aria-label="Registers">
          {PAIRS.map((pair) => (
            <div
              key={pair}
              className={styles.register}
              data-changed={(previous && previous[pair] !== snapshot[pair]) || undefined}
            >
              <dt>{pair.toUpperCase()}</dt>
              <dd>{hex4(snapshot[pair])}</dd>
            </div>
          ))}
        </dl>
        <ul className={styles.flags} aria-label="Flags">
          {FLAGS.map(([letter, bit, name]) => (
            <li key={letter} data-on={(f & bit) !== 0 || undefined} title={name}>
              <span aria-hidden="true">{letter}</span>
              <span className="visually-hidden">
                {name} {f & bit ? 'set' : 'clear'}
              </span>
            </li>
          ))}
          <li data-on={snapshot.ime || undefined} title="Interrupt master enable">
            IME<span className="visually-hidden"> {snapshot.ime ? 'on' : 'off'}</span>
          </li>
        </ul>
        <p className={styles.small}>
          CPU {snapshot.cpu} · LY {memory[0xff44]}
        </p>

        <div className={styles.cpuTables}>
          <table className={styles.table}>
            <caption className={styles.caption}>Interrupts</caption>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">IE</th>
                <th scope="col">IF</th>
              </tr>
            </thead>
            <tbody>
              {INTERRUPT_NAMES.map((name, bit) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{ie & (1 << bit) ? '●' : '·'}</td>
                  <td>{iflag & (1 << bit) ? '●' : '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className={styles.table}>
            <caption className={styles.caption}>Stack</caption>
            <tbody>
              {Array.from({ length: STACK_WORDS }, (_, i) => {
                const addr = (sp + i * 2) & 0xffff;
                const word = memory[addr]! | (memory[(addr + 1) & 0xffff]! << 8);
                return (
                  <tr key={i}>
                    <th scope="row">{hex4(addr)}</th>
                    <td>{hex4(word)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.cpuMain}>
        <div className={styles.viewBar}>
          <AddressForm
            label="Go to address"
            action="Go"
            symbols={symbols}
            onSubmit={({ addr }) => setAnchor(addr)}
          />
          <button
            type="button"
            className={`${panel.small} ${styles.fit}`}
            disabled={anchor === null}
            onClick={() => setAnchor(null)}
          >
            Follow PC
          </button>
        </div>
        <ol className={styles.disassembly} aria-label="Disassembly">
          {lines.map((line) => {
            const armed = armedAt(line.addr).length > 0;
            const label = symbols?.labelAt(line.addr, romBank);
            return (
              <Fragment key={line.addr}>
                {label && (
                  <li className={styles.label} aria-hidden="true">
                    {label}:
                  </li>
                )}
                <li
                  className={styles.line}
                  data-pc={line.addr === pc || undefined}
                  data-anchor={(anchor !== null && line.addr === anchor) || undefined}
                  aria-current={line.addr === pc ? 'step' : undefined}
                >
                  <button
                    type="button"
                    className={styles.gutter}
                    aria-pressed={armed}
                    aria-label={`Breakpoint at $${hex4(line.addr)}${label ? ` (${label})` : ''}`}
                    onClick={() => toggleBreakpoint(line.addr)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <span className={styles.addr}>{hex4(line.addr)}</span>
                  <span className={styles.bytes}>{line.bytes.map(hex2).join(' ')}</span>
                  <span className={styles.code}>{labelOperands(line.text, symbols, romBank)}</span>
                </li>
              </Fragment>
            );
          })}
        </ol>

        <div className={styles.points}>
          <PointList
            title="Breakpoints"
            hint="Stops before running the instruction at an address. In switchable ROM ($4000-$7FFF) a bank can be given, as in 03:4567."
            points={breakpoints}
            symbols={symbols}
            romBank={romBank}
            onAdd={(at) =>
              !breakpoints.some((b) => b.addr === at.addr && (b.bank ?? null) === at.bank) &&
              client.setBreakpoints([...breakpoints, at])
            }
            onRemove={(point) => client.setBreakpoints(breakpoints.filter((b) => b !== point))}
            onShow={setAnchor}
          />
          <PointList
            title="Watchpoints"
            hint="Stops after an instruction reads or writes an address."
            points={watchpoints}
            symbols={symbols}
            romBank={romBank}
            onAdd={({ addr }) =>
              !watchpoints.some((w) => w.addr === addr) &&
              client.setWatchpoints([...watchpoints, { addr, read: false, write: true }])
            }
            onRemove={(point) => client.setWatchpoints(watchpoints.filter((w) => w !== point))}
            details={(point) => (
              <>
                <span className={`${styles.small} ${styles.value}`}>
                  = {hex2(memory[point.addr]!)}
                </span>
                <AccessToggles
                  point={point}
                  onChange={(next) =>
                    client.setWatchpoints(watchpoints.map((w) => (w === point ? next : w)))
                  }
                />
              </>
            )}
          />
        </div>
      </div>
    </div>
  );
}

const location = (point: Breakpoint | Watchpoint): Location => ({
  addr: point.addr,
  bank: 'bank' in point ? (point.bank ?? null) : null,
});

interface PointListProps<T extends Breakpoint | Watchpoint> {
  title: string;
  hint: string;
  points: T[];
  symbols: SymbolTable | null;
  romBank: number;
  onAdd: (location: Location) => void;
  onRemove: (point: T) => void;
  /** Shows an address in the disassembly. */
  onShow?: (addr: number) => void;
  details?: (point: T) => ReactNode;
}

function PointList<T extends Breakpoint | Watchpoint>({
  title,
  hint,
  points,
  symbols,
  romBank,
  onAdd,
  onRemove,
  onShow,
  details,
}: PointListProps<T>) {
  const sorted = [...points].sort((a, b) => a.addr - b.addr);
  return (
    <section className={styles.pointList} aria-label={title}>
      <h2 className={styles.caption}>{title}</h2>
      <AddressForm
        label={`Add to ${title.toLowerCase()}`}
        action="Add"
        symbols={symbols}
        onSubmit={onAdd}
      />
      {sorted.length === 0 ? (
        <p className={styles.small}>{hint}</p>
      ) : (
        <ul className={styles.pointItems}>
          {sorted.map((point) => {
            const at = location(point);
            const name = formatLocation(at);
            const label = symbols?.labelAt(at.addr, at.bank ?? romBank);
            return (
              <li key={name}>
                {onShow ? (
                  <button type="button" className={styles.link} onClick={() => onShow(at.addr)}>
                    {name}
                  </button>
                ) : (
                  <span className={styles.mono}>{name}</span>
                )}
                {label && <span className={styles.small}>{label}</span>}
                {details?.(point)}
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove ${name} from ${title.toLowerCase()}`}
                  onClick={() => onRemove(point)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Read and write switches for a watchpoint; at least one stays on. */
function AccessToggles({
  point,
  onChange,
}: {
  point: Watchpoint;
  onChange: (point: Watchpoint) => void;
}) {
  const at = `$${hex4(point.addr)}`;
  return (
    <span className={styles.access}>
      {(['read', 'write'] as const).map((access) => {
        const on = point[access];
        const only = on && !point[access === 'read' ? 'write' : 'read'];
        return (
          <button
            key={access}
            type="button"
            className={styles.chip}
            aria-pressed={on}
            aria-label={`Stop on ${access}s of ${at}`}
            title={only ? 'A watchpoint needs reads or writes' : undefined}
            disabled={only}
            onClick={() => onChange({ ...point, [access]: !on })}
          >
            {access === 'read' ? 'R' : 'W'}
          </button>
        );
      })}
    </span>
  );
}
