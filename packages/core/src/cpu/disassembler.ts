import { CB_OPCODES } from './cb-opcodes';
import { OPCODES } from './opcodes';

export interface DisassembledInstruction {
  addr: number;
  length: number;
  bytes: number[];
  text: string;
}

const hex = (v: number, digits: number) => '$' + v.toString(16).toUpperCase().padStart(digits, '0');

/** Decodes the instruction at `addr` using the same tables the CPU executes. */
export function disassemble(read: (addr: number) => number, addr: number): DisassembledInstruction {
  const opcode = read(addr);
  const instruction = opcode === 0xcb ? CB_OPCODES[read((addr + 1) & 0xffff)]! : OPCODES[opcode]!;
  const bytes = Array.from({ length: instruction.length }, (_, i) => read((addr + i) & 0xffff));
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const text = instruction.mnemonic
    .replace('d16', hex(b1 | (b2 << 8), 4))
    .replace('a16', hex(b1 | (b2 << 8), 4))
    .replace('d8', hex(b1, 2))
    .replace('(a8)', `($FF00+${hex(b1, 2)})`)
    .replace(/\+?r8/, () => {
      const offset = (b1 << 24) >> 24;
      // Relative jumps show their target; SP offsets show a signed displacement.
      if (instruction.mnemonic.startsWith('JR')) return hex((addr + 2 + offset) & 0xffff, 4);
      return (offset < 0 ? '-' : '+') + hex(Math.abs(offset), 2);
    });
  return { addr, length: instruction.length, bytes, text };
}
