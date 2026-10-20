import { useCallback, useMemo, useState } from 'react';
import type { PartId } from './parts';

/** The guided tour: the parts in the order a frame of the game flows through them. */
export const TOUR: { part: PartId; story: string }[] = [
  {
    part: 'cartridge',
    story: 'It starts with the game: the CPU reads its instructions from the cartridge’s ROM.',
  },
  {
    part: 'crystal',
    story: 'The crystal sets the pace. Every part steps to its 4.19 MHz tick.',
  },
  {
    part: 'cpu',
    story:
      'The CPU runs those instructions, hundreds of thousands a second, and decides what happens.',
  },
  {
    part: 'wram',
    story: 'It keeps the game’s state, such as positions, scores and timers, in work RAM.',
  },
  {
    part: 'vram',
    story: 'When the picture should change, the CPU writes new tiles and maps into video RAM.',
  },
  {
    part: 'lcd',
    story: 'The PPU turns video RAM into pixels, line by line, and sends them to the LCD.',
  },
  {
    part: 'sound',
    story: 'Meanwhile the sound channels play the music and effects through the speaker.',
  },
  {
    part: 'link',
    story: 'Through the link port, two Game Boys can trade and play together.',
  },
  {
    part: 'power',
    story: 'And all of it runs on four AA batteries, through the power regulator.',
  },
];

/** Which part of a clear case is open, and where the guided tour is. */
export interface PartsView {
  selected: PartId | null;
  /** The tour step on show, or null outside the tour. */
  step: number | null;
  /** Opens a part, or closes it if it is the open one. Leaves the tour. */
  toggle: (id: PartId) => void;
  close: () => void;
  startTour: () => void;
  /** Shows tour step `step`; past the last one, the tour ends. */
  goTo: (step: number) => void;
}

export function usePartsView(): PartsView {
  const [state, setState] = useState<{ selected: PartId | null; step: number | null }>({
    selected: null,
    step: null,
  });
  const close = useCallback(() => setState({ selected: null, step: null }), []);
  const goTo = useCallback((step: number) => {
    const stop = TOUR[step];
    setState(stop ? { selected: stop.part, step } : { selected: null, step: null });
  }, []);
  const toggle = useCallback(
    (id: PartId) =>
      setState((current) => ({ selected: current.selected === id ? null : id, step: null })),
    [],
  );
  const startTour = useCallback(() => goTo(0), [goTo]);
  return useMemo(
    () => ({ ...state, toggle, close, startTour, goTo }),
    [state, toggle, close, startTour, goTo],
  );
}
