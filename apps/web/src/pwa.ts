import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import type { EmulatorClient } from './worker/client';

export interface PwaState {
  /** A new version is downloaded and waiting for the player to reload. */
  updateReady: boolean;
  /** The app was just cached for offline use (first visit). */
  offlineReady: boolean;
}

/** The game to reopen after reloading into a new version. */
const RELAUNCH_KEY = 'reactboy:relaunch';

let state: PwaState = { updateReady: false, offlineReady: false };
let updateServiceWorker: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Registers the service worker that keeps ReactBoy working offline. */
export function registerPwa(register = registerSW): void {
  if (!('serviceWorker' in navigator)) return;
  updateServiceWorker = register({
    onNeedRefresh: () => set({ updateReady: true }),
    onOfflineReady: () => set({ offlineReady: true }),
  });
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribe, () => state);
}

export function dismissPwaNotice(): void {
  set({ updateReady: false, offlineReady: false });
}

/**
 * Switches to the waiting version. The game is paused and its resume state stored first,
 * and the reloaded page reopens it (see {@link relaunch}), so nothing is lost.
 */
export async function applyUpdate(client: EmulatorClient): Promise<void> {
  const { gameId } = client.getSnapshot();
  client.pause();
  await client.persist();
  try {
    if (gameId) sessionStorage.setItem(RELAUNCH_KEY, gameId);
  } catch {
    // Without session storage the player picks the game from Recent games instead.
  }
  await updateServiceWorker?.(true);
}

/** Reopens the game that was playing before an update reload. */
export function relaunch(client: EmulatorClient): void {
  let id: string | null;
  try {
    id = sessionStorage.getItem(RELAUNCH_KEY);
    sessionStorage.removeItem(RELAUNCH_KEY);
  } catch {
    return;
  }
  if (id) void client.loadRecent(id);
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

/** Loads ROMs opened with the installed app from the operating system (Chromium). */
export function handleLaunchFiles(client: EmulatorClient): void {
  const queue = (
    window as { launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void } }
  ).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    const file = await files[0]?.getFile();
    if (file) await client.loadRom(file);
  });
}
