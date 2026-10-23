import { useEffect, useState } from 'react';
import { REDUCED_MOTION, useMediaQuery } from './useMediaQuery';

/** How long the device takes to come together; matches the delays in the shell and screen CSS. */
export const INTRO_MS = 3000;

/**
 * Whether the opening animation is playing: the board, case and controls coming together,
 * then the screen booting. Any key or press skips to the end, and reduced motion skips it.
 */
export function useIntro(): boolean {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const end = () => setPlaying(false);
    const timer = setTimeout(end, INTRO_MS);
    const options = { capture: true, passive: true };
    window.addEventListener('pointerdown', end, options);
    window.addEventListener('keydown', end, options);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', end, options);
      window.removeEventListener('keydown', end, options);
    };
  }, [playing]);

  return playing && !reduced;
}
