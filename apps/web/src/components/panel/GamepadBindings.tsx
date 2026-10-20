import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonId } from '@reactboy/core';
import { useEmulatorClient } from '../../hooks/useEmulator';
import { BUTTON_LABELS, DEFAULT_PADMAP, padButtonName, sameBindings } from '../../input/buttons';
import { BindingList } from './BindingList';
import styles from './Panel.module.css';

/** Indices of the buttons held on any connected gamepad. */
function heldButtons(): Set<number> {
  const held = new Set<number>();
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  for (const pad of pads) {
    pad?.buttons.forEach((button, index) => button.pressed && held.add(index));
  }
  return held;
}

const anyPad = () =>
  typeof navigator.getGamepads === 'function' && navigator.getGamepads().some(Boolean);

interface Props {
  padmap: Record<string, ButtonId>;
  onChange: (padmap: Record<string, ButtonId>) => void;
}

/** The gamepad layout, editable: press a controller button to bind it to a game button. */
export function GamepadBindings({ padmap, onChange }: Props) {
  const client = useEmulatorClient();
  /** The game button waiting for a controller button. */
  const [listening, setListening] = useState<ButtonId | null>(null);
  const [message, setMessage] = useState('');
  const [padFound, setPadFound] = useState(anyPad);
  const id = useId();
  // Read when a press arrives, so re-renders while waiting don't restart the wait.
  const latest = useRef({ padmap, onChange });
  useEffect(() => {
    latest.current = { padmap, onChange };
  });

  useEffect(() => {
    if (listening === null) return;
    // The press being bound shouldn't also reach the game.
    client.suspendGamepad(true);
    // Buttons already down don't count until they are let go and pressed again.
    let waiting = heldButtons();
    let frame = requestAnimationFrame(function poll() {
      const held = heldButtons();
      setPadFound(anyPad());
      const index = [...held].find((i) => !waiting.has(i));
      if (index === undefined) {
        waiting = new Set([...waiting].filter((i) => held.has(i)));
        frame = requestAnimationFrame(poll);
        return;
      }
      const name = padButtonName(String(index));
      const { padmap: current, onChange: change } = latest.current;
      const before = current[index];
      change({ ...current, [index]: listening });
      setMessage(
        before !== undefined && before !== listening
          ? `${name} moved from ${BUTTON_LABELS[before]} to ${BUTTON_LABELS[listening]}.`
          : `${name} now presses ${BUTTON_LABELS[listening]}.`,
      );
      setListening(null);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMessage('');
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, { capture: true });
      client.suspendGamepad(false);
    };
  }, [listening, client]);

  const unbind = (index: string) => {
    const next = { ...padmap };
    delete next[index];
    onChange(next);
    setMessage(`${padButtonName(index)} no longer presses anything.`);
  };

  let status = message;
  if (listening !== null) {
    status = padFound
      ? 'Press the controller button to use, or Escape to cancel.'
      : 'No controller yet: connect one and press any of its buttons, or Escape to cancel.';
  }

  return (
    <div className={styles.bindings}>
      <BindingList
        bindings={padmap}
        noun="button"
        name={padButtonName}
        listening={listening}
        onListen={setListening}
        onUnbind={unbind}
        describedBy={`${id}-message`}
      />
      <p id={`${id}-message`} className={styles.note} aria-live="polite">
        {status}
      </p>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={sameBindings(padmap, DEFAULT_PADMAP)}
          onClick={() => {
            onChange(DEFAULT_PADMAP);
            setMessage('Buttons reset to the defaults.');
          }}
        >
          Reset buttons
        </button>
      </div>
      <p className={styles.note}>
        Buttons are named by position on a standard controller. The left stick always works as the
        d-pad.
      </p>
    </div>
  );
}
