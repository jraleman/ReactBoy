import { useCallback, useState } from 'react';
import type { PaletteName } from '@reactboy/core';

export type ShellTheme = 'grey' | 'purple' | 'teal' | 'yellow';

export interface Settings {
  palette: PaletteName;
  shell: ShellTheme;
  speed: number;
}

const KEY = 'reactboy:settings';
const DEFAULTS: Settings = { palette: 'classic', shell: 'grey', speed: 1 };

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...stored };
  } catch {
    return DEFAULTS;
  }
}

/** Display preferences, remembered per browser. */
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
