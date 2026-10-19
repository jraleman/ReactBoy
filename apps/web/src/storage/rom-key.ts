const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * Identifies a ROM by content, so saves follow the game rather than its file name: a 64-bit
 * hash (two 32-bit lanes, cyrb53-style mixing) plus the size. Plain JS rather than
 * crypto.subtle, which is missing on plain-HTTP origins such as a phone testing over LAN.
 */
export function romKey(rom: ArrayBuffer): string {
  const bytes = new Uint8Array(rom);
  const words = new Uint32Array(rom, 0, rom.byteLength >> 2);
  let h1 = 0xdeadbeef ^ rom.byteLength;
  let h2 = 0x41c6ce57 ^ rom.byteLength;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    h1 = Math.imul(h1 ^ w, 2654435761);
    h2 = Math.imul(h2 ^ w, 1597334677);
    h1 = (h1 << 13) | (h1 >>> 19);
    h2 = (h2 << 17) | (h2 >>> 15);
  }
  for (let i = words.length * 4; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 2654435761);
    h2 = Math.imul(h2 ^ bytes[i]!, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${hex(h2)}${hex(h1)}-${rom.byteLength.toString(16)}`;
}
