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

/** W3C "standard" gamepad mapping, Nintendo-style: the right face button is A. */
export const GAMEPAD_BUTTONS: [index: number, button: ButtonId][] = [
  [1, Button.A],
  [0, Button.B],
  [9, Button.Start],
  [8, Button.Select],
  [12, Button.Up],
  [13, Button.Down],
  [14, Button.Left],
  [15, Button.Right],
];
