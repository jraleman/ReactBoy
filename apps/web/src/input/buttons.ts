import { Button, type ButtonId } from '@reactboy/core';

/** Where a press came from; the same button may be held by several sources at once. */
export type InputSource = 'keyboard' | 'touch' | 'gamepad';

export const BUTTON_LABELS: Record<ButtonId, string> = {
  [Button.Up]: 'Up',
  [Button.Down]: 'Down',
  [Button.Left]: 'Left',
  [Button.Right]: 'Right',
  [Button.A]: 'A',
  [Button.B]: 'B',
  [Button.Start]: 'Start',
  [Button.Select]: 'Select',
};

/** Two layouts bind the same inputs to the same buttons. */
export const sameBindings = (a: Record<string, ButtonId>, b: Record<string, ButtonId>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([input, button]) => b[input] === button);

/** Default keyboard layout, by KeyboardEvent.code so it works on any keyboard language. */
export const DEFAULT_KEYMAP: Record<string, ButtonId> = {
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  KeyX: Button.A,
  KeyZ: Button.B,
  Enter: Button.Start,
  Backspace: Button.Select,
  ShiftRight: Button.Select,
};

/** Keys with fixed jobs (see useShortcuts), plus Tab and Escape for getting around the page. */
export const RESERVED_KEYS: Record<string, string> = {
  F1: 'save state 1',
  F2: 'save state 2',
  F3: 'save state 3',
  KeyP: 'pause',
  Tab: 'moving between controls',
  Escape: 'cancelling',
};

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left ⌘',
  MetaRight: 'Right ⌘',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** A KeyboardEvent.code as printed on a US keyboard: "KeyZ" → "Z", "Numpad4" → "Num 4". */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const match = /^(?:Key|Digit)(.)$/.exec(code);
  if (match) return match[1]!;
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/**
 * Default gamepad layout by button index in the W3C "standard" mapping, Nintendo-style:
 * the right face button is A. The left stick always works as the d-pad as well.
 */
export const DEFAULT_PADMAP: Record<string, ButtonId> = {
  1: Button.A,
  0: Button.B,
  9: Button.Start,
  8: Button.Select,
  12: Button.Up,
  13: Button.Down,
  14: Button.Left,
  15: Button.Right,
};

/** Standard-mapping buttons by position, since labels differ between controller makers. */
const PAD_BUTTON_NAMES = [
  'Face ↓',
  'Face →',
  'Face ←',
  'Face ↑',
  'L1',
  'R1',
  'L2',
  'R2',
  'Select',
  'Start',
  'L3',
  'R3',
  'D-pad ↑',
  'D-pad ↓',
  'D-pad ←',
  'D-pad →',
  'Home',
];

/** A gamepad button index as a name: "1" → "Face →", "20" → "Button 20". */
export const padButtonName = (index: string) =>
  PAD_BUTTON_NAMES[Number(index)] ?? `Button ${index}`;
