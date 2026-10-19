import { useEffect } from 'react';
import type { ButtonId } from '@reactboy/core';
import type { EmulatorClient } from '../worker/client';

/** Elements where the keyboard belongs to the control, not the game. */
export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));

export function useKeyboard(client: EmulatorClient, keymap: Record<string, ButtonId>): void {
  useEffect(() => {
    const handle = (pressed: boolean) => (event: KeyboardEvent) => {
      const button = keymap[event.code];
      if (button === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;
      // Space/Enter on a focused toolbar button should activate it, not press Start.
      if (event.target instanceof HTMLButtonElement && event.code === 'Enter') return;
      event.preventDefault();
      if (!event.repeat) client.setButton('keyboard', button, pressed);
    };
    const down = handle(true);
    const up = handle(false);
    const release = () => client.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [client, keymap]);
}
