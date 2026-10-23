import { useCallback, useSyncExternalStore } from 'react';

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether `query` matches, following changes (window resizes, rotation). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
