import { Button, type ButtonId } from '@reactboy/core';
import { BUTTON_LABELS } from '../../input/buttons';
import styles from './Panel.module.css';

const ORDER: ButtonId[] = [
  Button.Up,
  Button.Down,
  Button.Left,
  Button.Right,
  Button.A,
  Button.B,
  Button.Start,
  Button.Select,
];

interface Props {
  /** Game buttons by input: a KeyboardEvent.code or a gamepad button index. */
  bindings: Record<string, ButtonId>;
  /** What one input is called: "key" or "button". */
  noun: string;
  name: (input: string) => string;
  /** The game button waiting for an input. */
  listening: ButtonId | null;
  onListen: (button: ButtonId | null) => void;
  onUnbind: (input: string) => void;
  /** The id of the status message. */
  describedBy: string;
}

/** Each game button with the inputs that press it, and controls to add or remove them. */
export function BindingList({
  bindings,
  noun,
  name,
  listening,
  onListen,
  onUnbind,
  describedBy,
}: Props) {
  return (
    <ul className={styles.bindList} aria-describedby={describedBy}>
      {ORDER.map((button) => {
        const label = BUTTON_LABELS[button];
        const inputs = Object.keys(bindings).filter((input) => bindings[input] === button);
        return (
          <li key={button} className={styles.bindRow}>
            <span className={styles.bindLabel}>{label}</span>
            <span className={styles.bindKeys}>
              {inputs.length === 0 && <span className={styles.note}>No {noun}</span>}
              {inputs.map((input) => (
                <span key={input} className={styles.bindKey}>
                  <kbd>{name(input)}</kbd>
                  <button
                    type="button"
                    className={styles.unbind}
                    aria-label={`Unbind ${name(input)} from ${label}`}
                    onClick={() => onUnbind(input)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              ))}
            </span>
            <button
              type="button"
              className={styles.small}
              aria-pressed={listening === button}
              aria-label={
                listening === button ? `Press a ${noun} for ${label}` : `Add a ${noun} for ${label}`
              }
              onClick={() => onListen(listening === button ? null : button)}
              onBlur={() => listening === button && onListen(null)}
            >
              {listening === button ? `Press a ${noun}…` : `Add ${noun}`}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
