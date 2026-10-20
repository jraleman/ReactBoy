import { expect, it } from 'vitest';
import { CB_OPCODES, disassemble, OPCODES } from '../src';

const at = (bytes: number[]) => (addr: number) => bytes[addr - 0x100] ?? 0;

it('formats operands from the instruction bytes', () => {
  expect(disassemble(at([0x01, 0x34, 0x12]), 0x100).text).toBe('LD BC,$1234');
  expect(disassemble(at([0x18, 0xfe]), 0x100).text).toBe('JR $0100');
  expect(disassemble(at([0xe0, 0x40]), 0x100).text).toBe('LDH ($FF00+$40),A');
  expect(disassemble(at([0xf8, 0xfb]), 0x100).text).toBe('LD HL,SP-$05');
  expect(disassemble(at([0xcb, 0x7c]), 0x100)).toMatchObject({ text: 'BIT 7,H', length: 2 });
});

it('defines all 512 opcodes with 11 illegal base opcodes', () => {
  expect(OPCODES).toHaveLength(256);
  expect(CB_OPCODES).toHaveLength(256);
  expect(OPCODES.filter((op) => op.mnemonic.startsWith('ILLEGAL'))).toHaveLength(11);
});
