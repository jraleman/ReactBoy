import type { Cpu } from './cpu';
import { R8_NAMES, type Instruction } from './instruction';

const SHIFT_NAMES = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SWAP', 'SRL'] as const;
const SHIFTS: readonly ((cpu: Cpu, v: number) => number)[] = [
  (cpu, v) => cpu.rlc(v),
  (cpu, v) => cpu.rrc(v),
  (cpu, v) => cpu.rl(v),
  (cpu, v) => cpu.rr(v),
  (cpu, v) => cpu.sla(v),
  (cpu, v) => cpu.sra(v),
  (cpu, v) => cpu.swap(v),
  (cpu, v) => cpu.srl(v),
];

/** The 256 opcodes following a 0xCB prefix: x = op>>6 picks shift/BIT/RES/SET, y the bit or shift, z the operand. */
export const CB_OPCODES: readonly Instruction[] = Array.from({ length: 256 }, (_, code) => {
  const x = code >> 6;
  const y = (code >> 3) & 7;
  const z = code & 7;
  const reg = R8_NAMES[z];
  switch (x) {
    case 0: {
      const shift = SHIFTS[y]!;
      return {
        mnemonic: `${SHIFT_NAMES[y]} ${reg}`,
        length: 2,
        execute: (cpu: Cpu) => cpu.setR8(z, shift(cpu, cpu.getR8(z))),
      };
    }
    case 1:
      return {
        mnemonic: `BIT ${y},${reg}`,
        length: 2,
        execute: (cpu: Cpu) => cpu.bit(y, cpu.getR8(z)),
      };
    case 2:
      return {
        mnemonic: `RES ${y},${reg}`,
        length: 2,
        execute: (cpu: Cpu) => cpu.setR8(z, cpu.getR8(z) & ~(1 << y)),
      };
    default:
      return {
        mnemonic: `SET ${y},${reg}`,
        length: 2,
        execute: (cpu: Cpu) => cpu.setR8(z, cpu.getR8(z) | (1 << y)),
      };
  }
});
