import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EmulatorClient, EmulatorState } from '../worker/client';

export const EmulatorContext = createContext<EmulatorClient | null>(null);

export function useEmulatorClient(): EmulatorClient {
  const client = useContext(EmulatorContext);
  if (!client) throw new Error('useEmulatorClient must be used inside <EmulatorContext.Provider>');
  return client;
}

/** Low-frequency emulator state (status, cartridge, fps). Never changes per frame. */
export function useEmulatorState(): EmulatorState {
  const client = useEmulatorClient();
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}
