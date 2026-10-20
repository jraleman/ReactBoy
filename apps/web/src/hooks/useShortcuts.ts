import { useEffect } from 'react';
import type { ManualSlot } from '../storage/store';
import type { EmulatorClient } from '../worker/client';
import { isEditable } from './useKeyboard';

const SLOT_KEYS: Record<string, ManualSlot> = { F1: '1', F2: '2', F3: '3' };

/**
 * Emulator shortcuts, as in mGBA and VBA: F1-F3 load a save-state slot, Shift+F1-F3 save to
 * it, and P pauses or resumes. These keys can't be bound to game buttons.
 */
export function useShortcuts(client: EmulatorClient): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isEditable(event.target)) return;
      const { status } = client.getSnapshot();
      if (status !== 'running' && status !== 'paused') return;
      const slot = SLOT_KEYS[event.code];
      if (slot) {
        // F1 would otherwise open the browser's help.
        event.preventDefault();
        void (event.shiftKey ? client.saveState(slot) : client.loadState(slot));
      } else if (event.code === 'KeyP' && !event.shiftKey) {
        event.preventDefault();
        if (status === 'running') client.pause();
        else client.play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client]);
}
