import { useCallback, useState } from 'react';
import type { PaletteName } from '@reactboy/core';

export type ShellTheme = 'grey' | 'purple' | 'teal' | 'yellow';

export interface Settings {
  palette: PaletteName;
  shell: ShellTheme;
  speed: number;
  /** 0-1. */
  volume: number;
  muted: boolean;
  /** Bit n set = sound channel n+1 is heard. */
  channels: number;
}

const KEY = 'reactboy:settings';
const DEFAULTS: Settings = {
  palette: 'classic',
  shell: 'grey',
  speed: 1,
  volume: 0.8,
  muted: false,
  channels: 0x0f,
};

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...stored };
  } catch {
    return DEFAULTS;
  }
}

/** Display and sound preferences, remembered per browser. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable (private mode, blocked); settings still apply this session.
      }
      return next;
    });
  }, []);
  return [settings, update];
}
