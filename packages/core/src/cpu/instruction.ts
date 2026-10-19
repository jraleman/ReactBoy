import type { Cpu } from './cpu';

export interface Instruction {
  /** Assembly with operand placeholders: d8, d16, a8, a16, r8 (signed offset). */
  mnemonic: string;
  /** Bytes including the opcode (and CB prefix for CB instructions). */
  length: number;
  execute(cpu: Cpu): void;
}

export const R8_NAMES = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'] as const;
