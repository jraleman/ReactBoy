import { describe, expect, it } from 'vitest';
import { computeScale, SHELL_HEIGHT, SHELL_WIDTH } from './useDeviceScale';

describe('computeScale', () => {
  it('snaps to whole device pixels when that costs little', () => {
    expect(computeScale(1440, 900, 1, true)).toBe(2);
    // 390pt-wide phone at 3x: 4 device px per Game Boy pixel.
    expect(computeScale(390, 844, 3, false)).toBeCloseTo(4 / 3);
  });

  it('falls back to a fractional fit rather than shrinking the device a lot', () => {
    const scale = computeScale(1366, 768, 1, true);
    expect(scale).toBeGreaterThan(1.5);
    expect(SHELL_HEIGHT * scale).toBeLessThanOrEqual(768 - 48);
  });

  it('always fits the available width on narrow screens', () => {
    for (const [w, dpr] of [
      [320, 2],
      [360, 3],
      [414, 2],
    ] as const) {
      expect(SHELL_WIDTH * computeScale(w, 700, dpr, false)).toBeLessThanOrEqual(w - 16);
    }
  });
});
