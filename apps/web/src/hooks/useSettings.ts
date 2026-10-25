import { useCallback, useState } from 'react';
import { PALETTES, type ButtonId, type ColorCorrection, type PaletteName } from '@reactboy/core';
import { isShellTheme, type ShellTheme } from '../components/shell/themes';
import { DEFAULT_KEYMAP, DEFAULT_PADMAP } from '../input/buttons';

export type { ShellTheme };

export interface Settings {
  /** The DMG's shades. */
  palette: PaletteName;
  /** How color games' colors are shown. */
  colorCorrection: ColorCorrection;
  shell: ShellTheme;
  /** The LCD contrast wheel, 0-1; 0.5 shows the palette as it is. */
  contrast: number;
  speed: number;
  /** 0-1. */
  volume: number;
  muted: boolean;
  /** Bit n set = sound channel n+1 is heard. */
  channels: number;
  /** The debugger is open in place of the controls. */
  debugger: boolean;
  /** Game buttons by KeyboardEvent.code. */
  keymap: Record<string, ButtonId>;
  /** Game buttons by gamepad button index (standard mapping), shared by all controllers. */
  padmap: Record<string, ButtonId>;
}

const KEY = 'reactboy:settings';
const DEFAULTS: Settings = {
  palette: 'classic',
  colorCorrection: 'lcd',
  shell: 'grey',
  contrast: 0.5,
  speed: 1,
  volume: 0.8,
  muted: false,
  channels: 0x0f,
  debugger: false,
  keymap: DEFAULT_KEYMAP,
  padmap: DEFAULT_PADMAP,
};

const isKeymap = (value: unknown): value is Record<string, ButtonId> =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((b) => Number.isInteger(b) && b >= 0 && b <= 7);

const isPadmap = (value: unknown): value is Record<string, ButtonId> =>
  isKeymap(value) && Object.keys(value).every((index) => /^\d{1,2}$/.test(index));

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const settings = { ...DEFAULTS, ...stored };
    // Stored by an older or newer version, or edited by hand: fall back field by field.
    if (!isKeymap(settings.keymap)) settings.keymap = DEFAULTS.keymap;
    if (!isPadmap(settings.padmap)) settings.padmap = DEFAULTS.padmap;
    if (!(settings.palette in PALETTES)) settings.palette = DEFAULTS.palette;
    if (settings.colorCorrection !== 'lcd' && settings.colorCorrection !== 'raw') {
      settings.colorCorrection = DEFAULTS.colorCorrection;
    }
    if (!isShellTheme(settings.shell)) settings.shell = DEFAULTS.shell;
    if (!(settings.contrast >= 0 && settings.contrast <= 1)) settings.contrast = DEFAULTS.contrast;
    return settings;
  } catch {
    return DEFAULTS;
  }
}

/** Display, sound, keyboard and gamepad preferences, remembered per browser. */
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
