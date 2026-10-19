import { Button } from '@reactboy/core';
import { dpadHitTest, usePointerButtons, type ButtonHandler } from '../../hooks/usePointerButtons';
import styles from './controls.module.css';

const ARMS = [
  { button: Button.Up, label: 'Up', className: styles.up },
  { button: Button.Right, label: 'Right', className: styles.right },
  { button: Button.Down, label: 'Down', className: styles.down },
  { button: Button.Left, label: 'Left', className: styles.left },
] as const;

export function DPad({ onButton, pressed }: { onButton: ButtonHandler; pressed: number }) {
  const handlers = usePointerButtons(dpadHitTest, onButton);
  return (
    <div className={styles.dpad} role="group" aria-label="Direction pad" {...handlers}>
      <div className={styles.cross} aria-hidden="true" />
      {ARMS.map(({ button, label, className }) => (
        // Touch is handled by the group; these stay labelled for assistive tech and tests.
        <button
          key={button}
          type="button"
          tabIndex={-1}
          className={`${styles.arm} ${className}`}
          aria-label={label}
          data-button={button}
          data-pressed={(pressed >> button) & 1 || undefined}
        />
      ))}
    </div>
  );
}
