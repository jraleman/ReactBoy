import { Button } from '@reactboy/core';
import { hitChildren, usePointerButtons, type ButtonHandler } from '../../hooks/usePointerButtons';
import styles from './controls.module.css';

export function StartSelect({ onButton, pressed }: { onButton: ButtonHandler; pressed: number }) {
  const handlers = usePointerButtons(hitChildren(0.4), onButton);
  return (
    <div className={styles.menu} role="group" aria-label="Select and Start" {...handlers}>
      {[
        { button: Button.Select, label: 'Select' },
        { button: Button.Start, label: 'Start' },
      ].map(({ button, label }) => (
        <span key={label} className={styles.menuItem}>
          <button
            type="button"
            tabIndex={-1}
            className={styles.pill}
            data-button={button}
            data-pressed={(pressed >> button) & 1 || undefined}
            aria-label={label}
          />
          <span className={styles.caption} aria-hidden="true">
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}
