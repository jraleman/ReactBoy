import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DebugState, EmulatorClient, EmulatorState, ProbeState } from '../worker/client';

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

/** The debugger's state; updates ~10 times a second while it is open and the game runs. */
export function useDebugState(): DebugState {
  const client = useEmulatorClient();
  return useSyncExternalStore(client.subscribeDebug, client.getDebugSnapshot);
}

/** Live machine state for the case's parts view; fresh only between setProbing(true/false). */
export function useProbeState(): ProbeState {
  const client = useEmulatorClient();
  return useSyncExternalStore(client.subscribeProbe, client.getProbeSnapshot);
}
