import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyUpdate, dismissPwaNotice, registerPwa, relaunch, usePwa } from './pwa';
import type { EmulatorClient } from './worker/client';

describe('PWA updates', () => {
  it('waits for the player, then saves the game and reopens it after reloading', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    const update = vi.fn(async () => {});
    let callbacks: { onNeedRefresh?: () => void } = {};
    registerPwa((options = {}) => {
      callbacks = options;
      return update;
    });
    const { result } = renderHook(() => usePwa());
    expect(result.current.updateReady).toBe(false);
    act(() => callbacks.onNeedRefresh?.());
    expect(result.current.updateReady).toBe(true);
    expect(update).not.toHaveBeenCalled();

    const order: string[] = [];
    const client = {
      getSnapshot: () => ({ gameId: 'game-1' }),
      pause: () => order.push('pause'),
      persist: async () => void order.push('persist'),
      loadRecent: vi.fn(async () => {}),
    } as unknown as EmulatorClient;
    update.mockImplementation(async () => void order.push('reload'));
    await applyUpdate(client);
    expect(order).toEqual(['pause', 'persist', 'reload']);
    expect(update).toHaveBeenCalledWith(true);

    // The reloaded page.
    relaunch(client);
    expect(client.loadRecent).toHaveBeenCalledWith('game-1');
    relaunch(client);
    expect(client.loadRecent).toHaveBeenCalledTimes(1);

    act(() => dismissPwaNotice());
    expect(result.current.updateReady).toBe(false);
  });
});
