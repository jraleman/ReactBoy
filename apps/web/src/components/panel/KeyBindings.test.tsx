import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, type ButtonId } from '@reactboy/core';
import { useSettings } from '../../hooks/useSettings';
import { useShortcuts } from '../../hooks/useShortcuts';
import { DEFAULT_KEYMAP, keyName } from '../../input/buttons';
import type { EmulatorClient } from '../../worker/client';
import { KeyBindings } from './KeyBindings';

function Harness({ onChange }: { onChange: (keymap: Record<string, ButtonId>) => void }) {
  const [keymap, setKeymap] = useState(DEFAULT_KEYMAP);
  return (
    <KeyBindings
      keymap={keymap}
      onChange={(next) => {
        setKeymap(next);
        onChange(next);
      }}
    />
  );
}

const press = (code: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { code, ...init });

describe('KeyBindings', () => {
  it('binds the next key pressed, moving it from another button', () => {
    const onChange = vi.fn();
    const game = vi.fn();
    window.addEventListener('keydown', game);
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add a key for A' }));
    expect(screen.getByText('Press the key to use, or Escape to cancel.')).toBeInTheDocument();
    press('KeyJ');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_KEYMAP, KeyJ: Button.A });
    expect(screen.getByText('J now presses A.')).toBeInTheDocument();
    // The game never saw the key that was being bound.
    expect(game).not.toHaveBeenCalled();
    window.removeEventListener('keydown', game);

    fireEvent.click(screen.getByRole('button', { name: 'Add a key for A' }));
    press('KeyZ');
    expect(onChange.mock.lastCall![0].KeyZ).toBe(Button.A);
    expect(screen.getByText('Z moved from B to A.')).toBeInTheDocument();
    expect(screen.getByText('No key', { selector: 'span' })).toBeInTheDocument();
  });

  it('refuses keys with other jobs and cancels on Escape', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a key for B' }));
    press('F1');
    expect(screen.getByRole('button', { name: 'Press a key for B' })).toBeInTheDocument();
    press('Escape');
    expect(screen.getByRole('button', { name: 'Add a key for B' })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('unbinds keys and resets to the defaults', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const reset = screen.getByRole('button', { name: 'Reset keys' });
    expect(reset).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Unbind X from A' }));
    expect(onChange.mock.lastCall![0]).not.toHaveProperty('KeyX');
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_KEYMAP);
  });

  it('names keys as printed on the keyboard', () => {
    expect(['KeyZ', 'Digit1', 'Numpad4', 'ShiftRight', 'ArrowUp', 'F5'].map(keyName)).toEqual([
      'Z',
      '1',
      'Num 4',
      'Right Shift',
      '↑',
      'F5',
    ]);
  });
});

describe('useShortcuts', () => {
  const fakeClient = (status: string) =>
    ({
      getSnapshot: () => ({ status }),
      saveState: vi.fn(async () => {}),
      loadState: vi.fn(async () => {}),
      pause: vi.fn(),
      play: vi.fn(),
    }) as unknown as EmulatorClient & Record<string, ReturnType<typeof vi.fn>>;

  it('saves, loads and pauses from the keyboard while a game is loaded', () => {
    const client = fakeClient('running');
    renderHook(() => useShortcuts(client));
    press('F1', { shiftKey: true });
    press('F2');
    press('KeyP');
    expect(client.saveState).toHaveBeenCalledWith('1');
    expect(client.loadState).toHaveBeenCalledWith('2');
    expect(client.pause).toHaveBeenCalled();
  });

  it('stays out of the way without a game, in text fields and with modifiers', () => {
    const idle = fakeClient('empty');
    const { unmount } = renderHook(() => useShortcuts(idle));
    press('F1');
    expect(idle.loadState).not.toHaveBeenCalled();
    unmount();

    const client = fakeClient('paused');
    renderHook(() => useShortcuts(client));
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { code: 'KeyP' });
    press('F1', { ctrlKey: true });
    expect(client.play).not.toHaveBeenCalled();
    expect(client.loadState).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('useSettings', () => {
  afterEach(() => localStorage.clear());

  it('keeps a custom keymap and ignores a damaged one', () => {
    localStorage.setItem('reactboy:settings', JSON.stringify({ keymap: { KeyJ: Button.A } }));
    expect(renderHook(() => useSettings()).result.current[0].keymap).toEqual({ KeyJ: Button.A });

    localStorage.setItem(
      'reactboy:settings',
      JSON.stringify({ keymap: { KeyJ: 'A' }, volume: 0.5 }),
    );
    const [settings] = renderHook(() => useSettings()).result.current;
    expect(settings.keymap).toEqual(DEFAULT_KEYMAP);
    expect(settings.volume).toBe(0.5);
  });
});
