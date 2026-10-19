import { useId, useRef, useState } from 'react';
import { useEmulatorClient } from '../../hooks/useEmulator';
import type { StoredSymbols } from '../../storage/store';
import panel from '../panel/Panel.module.css';
import styles from './Debugger.module.css';
import { parseSymbols, type SymbolTable } from './symbols';

interface Props {
  stored: StoredSymbols | null;
  symbols: SymbolTable | null;
}

/** Loads, replaces or forgets the game's RGBDS symbol file, which is kept with its saves. */
export function SymbolsBar({ stored, symbols }: Props) {
  const client = useEmulatorClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const id = useId();

  const load = async (file: File) => {
    const text = await file.text();
    if (parseSymbols(text).count === 0) {
      setError(`No symbols in ${file.name}. Expected an RGBDS .sym file ("00:0150 Main").`);
      return;
    }
    setError('');
    await client.setSymbols({ name: file.name, text });
  };

  return (
    <div className={styles.symbols} aria-describedby={error ? `${id}-error` : undefined}>
      <span className={styles.small}>
        {stored && symbols
          ? `Symbols: ${stored.name} (${symbols.count.toLocaleString('en')})`
          : 'No symbols loaded'}
      </span>
      <input
        ref={input}
        type="file"
        accept=".sym,text/plain"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void load(file);
        }}
      />
      <button
        type="button"
        className={`${panel.small} ${styles.fit}`}
        onClick={() => input.current?.click()}
      >
        {stored ? 'Replace…' : 'Load .sym…'}
      </button>
      {stored && (
        <button
          type="button"
          className={`${panel.small} ${styles.fit}`}
          onClick={() => void client.setSymbols(null)}
        >
          Clear
        </button>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
