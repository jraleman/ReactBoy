import { useCallback, useRef, type PointerEvent } from 'react';
import { Button, type ButtonId } from '@reactboy/core';

export type ButtonHandler = (button: ButtonId, pressed: boolean) => void;

/** Resolves which buttons a pointer at (x, y), relative to the container, is holding. */
export type HitTest = (x: number, y: number, container: HTMLElement, rect: DOMRect) => ButtonId[];

/**
 * Multitouch press tracking for a group of on-screen buttons. Each pointer can slide across
 * the group (thumb rolling from B to A, or around the d-pad) and presses/releases follow it.
 */
export function usePointerButtons(hitTest: HitTest, onButton: ButtonHandler) {
  const pointers = useRef(new Map<number, ButtonId[]>());

  const apply = useCallback(
    (pointerId: number, next: ButtonId[]) => {
      const map = pointers.current;
      const before = map.get(pointerId) ?? [];
      map.set(pointerId, next);
      const stillHeld = (button: ButtonId) =>
        [...map.values()].some((buttons) => buttons.includes(button));
      for (const button of before) {
        if (!next.includes(button) && !stillHeld(button)) onButton(button, false);
      }
      for (const button of next) {
        if (!before.includes(button)) {
          onButton(button, true);
          navigator.vibrate?.(8);
        }
      }
      if (next.length === 0) map.delete(pointerId);
    },
    [onButton],
  );

  const track = (event: PointerEvent<HTMLElement>) => {
    const { currentTarget } = event;
    const rect = currentTarget.getBoundingClientRect();
    apply(
      event.pointerId,
      hitTest(event.clientX - rect.left, event.clientY - rect.top, currentTarget, rect),
    );
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      track(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (pointers.current.has(event.pointerId)) track(event);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => apply(event.pointerId, []),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => apply(event.pointerId, []),
  };
}

/** Hit test against children marked with data-button, using their layout boxes. */
export const hitChildren =
  (slop = 0.25): HitTest =>
  (x, y, container, rect) => {
    const hits: ButtonId[] = [];
    for (const el of container.querySelectorAll<HTMLElement>('[data-button]')) {
      const box = el.getBoundingClientRect();
      // Grow each target a little: thumbs are bigger than the painted buttons.
      const padX = box.width * slop;
      const padY = box.height * slop;
      const left = box.left - rect.left - padX;
      const top = box.top - rect.top - padY;
      if (
        x >= left &&
        x <= left + box.width + 2 * padX &&
        y >= top &&
        y <= top + box.height + 2 * padY
      ) {
        hits.push(Number(el.dataset.button) as ButtonId);
      }
    }
    return hits;
  };

/** Direction(s) for a touch relative to the pad's center; the dead zone avoids accidental input. */
export const dpadHitTest: HitTest = (x, y, _container, rect) => {
  const dx = x / rect.width - 0.5;
  const dy = y / rect.height - 0.5;
  if (Math.hypot(dx, dy) < 0.12) return [];
  // Within ~22° of an axis counts as a pure direction; between them, a diagonal.
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const result: ButtonId[] = [];
  if (angle > -67.5 && angle < 67.5) result.push(Button.Right);
  if (angle > 112.5 || angle < -112.5) result.push(Button.Left);
  if (angle > 22.5 && angle < 157.5) result.push(Button.Down);
  if (angle < -22.5 && angle > -157.5) result.push(Button.Up);
  return result;
};
