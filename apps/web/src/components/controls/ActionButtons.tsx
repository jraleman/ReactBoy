import { Button } from '@reactboy/core';
import { hitChildren, usePointerButtons, type ButtonHandler } from '../../hooks/usePointerButtons';
import styles from './controls.module.css';

export function ActionButtons({ onButton, pressed }: { onButton: ButtonHandler; pressed: number }) {
  const handlers = usePointerButtons(hitChildren(0.15), onButton);
  return (
    <div className={styles.actions} role="group" aria-label="A and B buttons" {...handlers}>
      <div className={styles.actionWell} aria-hidden="true" />
      <span className={styles.actionB}>
        <button
          type="button"
          tabIndex={-1}
          className={styles.round}
          data-button={Button.B}
          data-pressed={(pressed >> Button.B) & 1 || undefined}
          aria-label="B"
        />
        <span className={styles.caption} aria-hidden="true">
          B
        </span>
      </span>
      <span className={styles.actionA}>
        <button
          type="button"
          tabIndex={-1}
          className={styles.round}
          data-button={Button.A}
          data-pressed={(pressed >> Button.A) & 1 || undefined}
          aria-label="A"
        />
        <span className={styles.caption} aria-hidden="true">
          A
        </span>
      </span>
    </div>
  );
}
