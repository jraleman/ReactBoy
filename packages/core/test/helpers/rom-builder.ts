/** Builds a minimal valid ROM with `program` at the 0x0100 entry point. */
export function makeRom(
  program: number[],
  { type = 0x00, romSizeCode = 0x00, ramSizeCode = 0x00, title = 'TEST' } = {},
): Uint8Array {
  const rom = new Uint8Array(0x8000 << romSizeCode);
  rom.set(program, 0x100);
  for (let i = 0; i < title.length; i++) rom[0x134 + i] = title.charCodeAt(i);
  rom[0x147] = type;
  rom[0x148] = romSizeCode;
  rom[0x149] = ramSizeCode;
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}
