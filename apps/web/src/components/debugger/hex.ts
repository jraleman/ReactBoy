/** "3F" */
export const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
/** "C0DE" */
export const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');

/** Parses "C000", "$C000" or "0xC000" as a 16-bit address; null if it isn't one. */
export function parseAddress(text: string): number | null {
  const digits = text.trim().replace(/^(\$|0x)/i, '');
  if (!/^[0-9a-f]{1,4}$/i.test(digits)) return null;
  return parseInt(digits, 16);
}

/** Named areas of the address space, for jumping around and labelling addresses. */
export const REGIONS = [
  { name: 'ROM0', start: 0x0000, label: 'ROM bank 0' },
  { name: 'ROMX', start: 0x4000, label: 'Switchable ROM bank' },
  { name: 'VRAM', start: 0x8000, label: 'Video RAM' },
  { name: 'SRAM', start: 0xa000, label: 'Cartridge RAM' },
  { name: 'WRAM', start: 0xc000, label: 'Work RAM' },
  { name: 'Echo', start: 0xe000, label: 'Echo of work RAM' },
  { name: 'OAM', start: 0xfe00, label: 'Sprite attributes' },
  { name: 'Unused', start: 0xfea0, label: 'Unusable' },
  { name: 'I/O', start: 0xff00, label: 'Hardware registers' },
  { name: 'HRAM', start: 0xff80, label: 'High RAM' },
  { name: 'IE', start: 0xffff, label: 'Interrupt enable' },
] as const;

export function regionOf(addr: number): (typeof REGIONS)[number] {
  let found: (typeof REGIONS)[number] = REGIONS[0];
  for (const region of REGIONS) if (addr >= region.start) found = region;
  return found;
}
