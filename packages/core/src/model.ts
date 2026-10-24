import type { CartridgeHeader } from './cartridge';

/** The console being emulated: the original Game Boy, or a Game Boy Color in color mode. */
export type Model = 'dmg' | 'cgb';

/**
 * The model a game gets on a Game Boy Color: color mode if its header sets bit 7 of the CGB
 * flag, as color-only and dual-mode games do. That bit is what the color boot ROM checks.
 */
export function preferredModel(header: CartridgeHeader): Model {
  return header.cgbFlag & 0x80 ? 'cgb' : 'dmg';
}
