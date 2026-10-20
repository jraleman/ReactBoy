import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@reactboy/core';
import { dpadHitTest } from '../../hooks/usePointerButtons';
import { DPad } from './DPad';
import { ActionButtons } from './ActionButtons';

const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;

describe('dpadHitTest', () => {
  it('maps touches to directions with a dead zone and diagonals', () => {
    expect(dpadHitTest(50, 50, document.body, rect)).toEqual([]);
    expect(dpadHitTest(50, 5, document.body, rect)).toEqual([Button.Up]);
    expect(dpadHitTest(95, 50, document.body, rect)).toEqual([Button.Right]);
    expect(dpadHitTest(90, 90, document.body, rect).sort()).toEqual(
      [Button.Right, Button.Down].sort(),
    );
  });
});

describe('touch controls', () => {
  it('presses and releases d-pad directions as a pointer moves', () => {
    const onButton = vi.fn();
    render(<DPad onButton={onButton} pressed={0} />);
    const pad = screen.getByRole('group', { name: 'Direction pad' });
    pad.getBoundingClientRect = () => rect;

    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 5 });
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 5, clientY: 50 });
    fireEvent.pointerUp(pad, { pointerId: 1 });

    expect(onButton.mock.calls).toEqual([
      [Button.Up, true],
      [Button.Up, false],
      [Button.Left, true],
      [Button.Left, false],
    ]);
  });

  it('exposes labelled A and B buttons that reflect the pressed state', () => {
    render(<ActionButtons onButton={() => {}} pressed={1 << Button.A} />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('data-pressed', '1');
    expect(screen.getByRole('button', { name: 'B' })).not.toHaveAttribute('data-pressed');
  });
});
