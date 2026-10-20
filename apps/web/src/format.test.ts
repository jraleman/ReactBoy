import { describe, expect, it } from 'vitest';
import { formatPlayed, formatSaved } from './format';

const now = new Date(2026, 9, 18, 15, 0).getTime();

describe('formatSaved', () => {
  it('names today and yesterday, and dates anything older', () => {
    expect(formatSaved(new Date(2026, 9, 18, 0, 5).getTime(), now)).toMatch(/^Today, 12:05/);
    expect(formatSaved(new Date(2026, 9, 17, 23, 59).getTime(), now)).toMatch(/^Yesterday, /);
    expect(formatSaved(new Date(2026, 9, 3, 9, 0).getTime(), now)).toMatch(/^Oct 3, /);
    expect(formatSaved(new Date(2025, 9, 3, 9, 0).getTime(), now)).toMatch(/2025/);
  });
});

describe('formatPlayed', () => {
  it('says when a game was last played', () => {
    expect(formatPlayed(now - 60_000, now)).toBe('Played today');
    expect(formatPlayed(new Date(2026, 9, 17, 8).getTime(), now)).toBe('Played yesterday');
    expect(formatPlayed(new Date(2026, 8, 30).getTime(), now)).toBe('Played Sep 30');
  });
});
