import { disassemble, type DisassembledInstruction } from '@reactboy/core';

/**
 * Instructions around `addr`: `before` lines leading up to it and `after` from it.
 *
 * Code can't be decoded backwards, so this tries start points further and further back
 * and keeps the first whose instructions land exactly on `addr`. Starting far back lets
 * decoding fall into step with the real instruction stream before it reaches `addr`.
 */
export function disassembleAround(
  memory: Uint8Array,
  addr: number,
  before: number,
  after: number,
): DisassembledInstruction[] {
  const read = (a: number) => memory[a & 0xffff]!;
  let lead: DisassembledInstruction[] = [];
  for (let back = Math.min(addr, before * 3); back > 0; back--) {
    const lines: DisassembledInstruction[] = [];
    let at = addr - back;
    while (at < addr) {
      const line = disassemble(read, at);
      lines.push(line);
      at += line.length;
    }
    if (at === addr) {
      lead = lines.slice(-before);
      break;
    }
  }
  const lines = [...lead];
  for (let i = 0, at = addr; i < after && at <= 0xffff; i++) {
    const line = disassemble(read, at);
    lines.push(line);
    at += line.length;
  }
  return lines;
}
