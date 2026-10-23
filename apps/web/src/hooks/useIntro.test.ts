import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTRO_MS, useIntro } from './useIntro';

function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('useIntro', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays once, for as long as the device takes to come together', () => {
    preferReducedMotion(false);
    const { result } = renderHook(useIntro);
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(INTRO_MS - 1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('skips to the end on a key or press', () => {
    preferReducedMotion(false);
    const { result } = renderHook(useIntro);
    act(() => void fireEvent.keyDown(window, { key: 'x' }));
    expect(result.current).toBe(false);

    const again = renderHook(useIntro);
    act(() => void fireEvent.pointerDown(window));
    expect(again.result.current).toBe(false);
  });

  it('never plays with reduced motion', () => {
    preferReducedMotion(true);
    expect(renderHook(useIntro).result.current).toBe(false);
  });
});
