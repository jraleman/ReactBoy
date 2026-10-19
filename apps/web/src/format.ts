const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** Whole calendar days from `ms` to `now` (0 = same day). */
const daysAgo = (ms: number, now: number) =>
  Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);

const time = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ms);

const date = (ms: number, now: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  }).format(ms);

/** When a save state was made: "Today, 2:05 PM", "Yesterday, 9:40 AM", "Oct 3, 6:12 PM". */
export function formatSaved(ms: number, now = Date.now()): string {
  const days = daysAgo(ms, now);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date(ms, now);
  return `${day}, ${time(ms)}`;
}

/** When a game was last played: "Played today", "Played yesterday", "Played Oct 3". */
export function formatPlayed(ms: number, now = Date.now()): string {
  const days = daysAgo(ms, now);
  return `Played ${days === 0 ? 'today' : days === 1 ? 'yesterday' : date(ms, now)}`;
}
