import { useEffect, useState } from 'react';

/** Size of the handheld in Game Boy pixels; everything in the shell is laid out in these units. */
export const SHELL_WIDTH = 256;
export const SHELL_HEIGHT = 410;
/** Wide layouts put the control panel beside the device. */
export const WIDE_QUERY = '(min-width: 880px)';
const PANEL_WIDTH = 320;

/**
 * CSS pixels per Game Boy pixel. Prefers a whole number of *device* pixels so the LCD stays
 * crisp, unless that would shrink the device by more than 20% compared to the best fit.
 */
export function computeScale(width: number, height: number, dpr: number, wide: boolean): number {
  const availWidth = wide ? width - PANEL_WIDTH - 96 : width - 16;
  const availHeight = wide ? height - 48 : Math.max(height - 16, width * 1.2);
  const fit = Math.min(availWidth / SHELL_WIDTH, availHeight / SHELL_HEIGHT) * dpr;
  const whole = Math.floor(fit);
  const devicePixels = whole >= 1 && whole / fit >= 0.8 ? whole : Math.max(fit, 1);
  return devicePixels / dpr;
}

const measure = () =>
  computeScale(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio || 1,
    window.matchMedia(WIDE_QUERY).matches,
  );

export function useDeviceScale(): number {
  const [scale, setScale] = useState(measure);
  useEffect(() => {
    const update = () => setScale(measure());
    window.addEventListener('resize', update);
    // Zooming or moving to another monitor changes devicePixelRatio without a resize.
    let dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDpr = () => {
      update();
      dprQuery.removeEventListener('change', onDpr);
      dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };
    dprQuery.addEventListener('change', onDpr);
    return () => {
      window.removeEventListener('resize', update);
      dprQuery.removeEventListener('change', onDpr);
    };
  }, []);
  return scale;
}
