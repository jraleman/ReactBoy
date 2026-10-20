import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, type ButtonId } from '@reactboy/core';
import { EmulatorContext } from '../../hooks/useEmulator';
import { useSettings } from '../../hooks/useSettings';
import { DEFAULT_PADMAP, padButtonName } from '../../input/buttons';
import { MemoryStore } from '../../storage/store';
import { EmulatorClient } from '../../worker/client';
import { GamepadBindings } from './GamepadBindings';

/** A standard-mapping controller whose buttons the test presses. */
function connectPad() {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  const pad = { buttons, axes: [0, 0] };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  return (index: number, pressed = true) => (buttons[index]!.pressed = pressed);
}

afterEach(() => {
  delete (navigator as { getGamepads?: unknown }).getGamepads;
  localStorage.clear();
});

function Harness({ onChange }: { onChange: (padmap: Record<string, ButtonId>) => void }) {
  const [padmap, setPadmap] = useState(DEFAULT_PADMAP);
  return (
    <GamepadBindings
      padmap={padmap}
      onChange={(next) => {
        setPadmap(next);
        onChange(next);
      }}
    />
  );
}

function setup() {
  const client = { suspendGamepad: vi.fn() } as unknown as EmulatorClient;
  const onChange = vi.fn();
  render(
    <EmulatorContext.Provider value={client}>
      <Harness onChange={onChange} />
    </EmulatorContext.Provider>,
  );
  return {
    client: client as EmulatorClient & { suspendGamepad: ReturnType<typeof vi.fn> },
    onChange,
  };
}

describe('GamepadBindings', () => {
  it('binds the next controller button pressed, keeping it from the game meanwhile', async () => {
    const { client, onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add a button for A' }));
    expect(screen.getByText(/^No controller yet/)).toBeInTheDocument();
    expect(client.suspendGamepad).toHaveBeenLastCalledWith(true);

    const press = connectPad();
    await screen.findByText('Press the controller button to use, or Escape to cancel.');
    press(4);
    expect(await screen.findByText('L1 now presses A.')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PADMAP, 4: Button.A });
    expect(client.suspendGamepad).toHaveBeenLastCalledWith(false);
  });

  it('ignores a button already held until it is pressed again', async () => {
    const { onChange } = setup();
    const press = connectPad();
    press(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add a button for Start' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();

    press(0, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    press(0);
    expect(await screen.findByText('Face ↓ moved from B to Start.')).toBeInTheDocument();
    expect(screen.getByText('No button', { selector: 'span' })).toBeInTheDocument();
  });

  it('cancels on Escape, unbinds and resets', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add a button for B' }));
    fireEvent.keyDown(window, { code: 'Escape' });
    expect(screen.getByRole('button', { name: 'Add a button for B' })).toBeInTheDocument();

    const reset = screen.getByRole('button', { name: 'Reset buttons' });
    expect(reset).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Unbind Face → from A' }));
    expect(onChange.mock.lastCall![0]).not.toHaveProperty('1');
    fireEvent.click(reset);
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_PADMAP);
  });

  it('names buttons by their standard position', () => {
    expect(['0', '3', '12', '16', '20'].map(padButtonName)).toEqual([
      'Face ↓',
      'Face ↑',
      'D-pad ↑',
      'Home',
      'Button 20',
    ]);
  });

  it('keeps a custom layout in the settings and ignores a damaged one', () => {
    localStorage.setItem('reactboy:settings', JSON.stringify({ padmap: { 4: Button.A } }));
    expect(renderHook(() => useSettings()).result.current[0].padmap).toEqual({ 4: Button.A });
    localStorage.setItem('reactboy:settings', JSON.stringify({ padmap: { L1: Button.A } }));
    expect(renderHook(() => useSettings()).result.current[0].padmap).toEqual(DEFAULT_PADMAP);
  });
});

describe('EmulatorClient gamepads', () => {
  it('uses the layout it is given, and nothing while suspended', async () => {
    const client = new EmulatorClient({ store: new MemoryStore() });
    await client.loadRom(new Blob([new Uint8Array(0x8000)]));
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('running'));
    const press = connectPad();
    client.setGamepadMap({ 4: Button.A });
    press(4);
    press(1); // A by default, unbound now
    await vi.waitFor(() => expect(client.getSnapshot().pressed).toBe(1 << Button.A));

    client.suspendGamepad(true);
    await vi.waitFor(() => expect(client.getSnapshot().pressed).toBe(0));
    client.dispose();
  });
});
