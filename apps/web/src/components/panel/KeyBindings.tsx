import { useEffect, useId, useState } from 'react';
import type { ButtonId } from '@reactboy/core';
import {
  BUTTON_LABELS,
  DEFAULT_KEYMAP,
  keyName,
  RESERVED_KEYS,
  sameBindings,
} from '../../input/buttons';
import { BindingList } from './BindingList';
import styles from './Panel.module.css';

interface Props {
  keymap: Record<string, ButtonId>;
  onChange: (keymap: Record<string, ButtonId>) => void;
}

/** The keyboard layout, editable: press a key to bind it to a button. */
export function KeyBindings({ keymap, onChange }: Props) {
  /** The button waiting for a key press. */
  const [listening, setListening] = useState<ButtonId | null>(null);
  const [message, setMessage] = useState('');
  const id = useId();

  useEffect(() => {
    if (listening === null) return;
    const onKey = (event: KeyboardEvent) => {
      // Ahead of the game and the shortcuts, which listen on the way back up.
      event.preventDefault();
      event.stopPropagation();
      const name = keyName(event.code);
      if (event.code === 'Escape') {
        setMessage('');
      } else if (RESERVED_KEYS[event.code]) {
        setMessage(`${name} is used for ${RESERVED_KEYS[event.code]}. Try another key.`);
        return;
      } else {
        const before = keymap[event.code];
        onChange({ ...keymap, [event.code]: listening });
        setMessage(
          before !== undefined && before !== listening
            ? `${name} moved from ${BUTTON_LABELS[before]} to ${BUTTON_LABELS[listening]}.`
            : `${name} now presses ${BUTTON_LABELS[listening]}.`,
        );
      }
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening, keymap, onChange]);

  const unbind = (code: string) => {
    const next = { ...keymap };
    delete next[code];
    onChange(next);
    setMessage(`${keyName(code)} no longer presses anything.`);
  };

  return (
    <div className={styles.bindings}>
      <BindingList
        bindings={keymap}
        noun="key"
        name={keyName}
        listening={listening}
        onListen={setListening}
        onUnbind={unbind}
        describedBy={`${id}-message`}
      />
      <p id={`${id}-message`} className={styles.note} aria-live="polite">
        {listening !== null ? 'Press the key to use, or Escape to cancel.' : message}
      </p>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={sameBindings(keymap, DEFAULT_KEYMAP)}
          onClick={() => {
            onChange(DEFAULT_KEYMAP);
            setMessage('Keys reset to the defaults.');
          }}
        >
          Reset keys
        </button>
      </div>
      <dl className={styles.keys} aria-label="Shortcuts">
        <div className={styles.keyRow}>
          <dt>Save state</dt>
          <dd>
            <kbd>Shift</kbd> + <kbd>F1</kbd>–<kbd>F3</kbd>
          </dd>
        </div>
        <div className={styles.keyRow}>
          <dt>Load state</dt>
          <dd>
            <kbd>F1</kbd>–<kbd>F3</kbd>
          </dd>
        </div>
        <div className={styles.keyRow}>
          <dt>Pause</dt>
          <dd>
            <kbd>P</kbd>
          </dd>
        </div>
      </dl>
    </div>
  );
}
