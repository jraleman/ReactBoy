/**
 * Case colors. Clear cases are tinted see-through plastic over the circuit board, whose
 * parts can then be inspected; the grey case is the solid original.
 */
export const SHELLS = [
  { id: 'grey', name: 'Grey', color: '#c5c1bb', clear: false },
  { id: 'purple', name: 'Atomic Purple', color: 'rgb(98 56 168 / 0.6)', clear: true },
  { id: 'teal', name: 'Teal', color: 'rgb(22 146 140 / 0.55)', clear: true },
  { id: 'yellow', name: 'Yellow', color: 'rgb(246 196 30 / 0.55)', clear: true },
  { id: 'clear', name: 'Crystal Clear', color: 'rgb(214 228 240 / 0.25)', clear: true },
  { id: 'smoke', name: 'Smoke Black', color: 'rgb(24 24 32 / 0.65)', clear: true },
  { id: 'red', name: 'Cherry Red', color: 'rgb(208 24 52 / 0.55)', clear: true },
  { id: 'blue', name: 'Ice Blue', color: 'rgb(136 198 246 / 0.45)', clear: true },
] as const;

export type ShellTheme = (typeof SHELLS)[number]['id'];

export const isShellTheme = (value: unknown): value is ShellTheme =>
  SHELLS.some((shell) => shell.id === value);

export const isClear = (theme: ShellTheme): boolean =>
  SHELLS.find((shell) => shell.id === theme)?.clear ?? false;
