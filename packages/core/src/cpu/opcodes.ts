import type { Cpu } from './cpu';
import { R8_NAMES, type Instruction } from './instruction';
import { A, C, F, FLAG_C, FLAG_H, FLAG_N, FLAG_Z, HL_INDIRECT } from './registers';

const RP = ['BC', 'DE', 'HL', 'SP'] as const;
const RP2 = ['BC', 'DE', 'HL', 'AF'] as const;
const CC = ['NZ', 'Z', 'NC', 'C'] as const;
const ALU_NAMES = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '] as const;

/** ADD, ADC, SUB, SBC, AND, XOR, OR, CP by opcode encoding. */
const ALU: readonly ((cpu: Cpu, v: number) => void)[] = [
  (cpu, v) => cpu.add(v, 0),
  (cpu, v) => cpu.add(v, cpu.carry()),
  (cpu, v) => cpu.sub(v, 0, true),
  (cpu, v) => cpu.sub(v, cpu.carry(), true),
  (cpu, v) => cpu.and(v),
  (cpu, v) => cpu.xor(v),
  (cpu, v) => cpu.or(v),
  (cpu, v) => cpu.sub(v, 0, false),
];

const illegal = (code: number): Instruction => ({
  mnemonic: `ILLEGAL_${code.toString(16).toUpperCase().padStart(2, '0')}`,
  length: 1,
  execute: (cpu) => {
    cpu.locked = true;
  },
});

/** The 256 base opcodes, indexed by opcode byte. */
export const OPCODES: readonly Instruction[] = buildOpcodes();

function buildOpcodes(): Instruction[] {
  const table: Instruction[] = Array.from({ length: 256 }, (_, code) => illegal(code));
  const op = (code: number, mnemonic: string, length: number, execute: (cpu: Cpu) => void) => {
    table[code] = { mnemonic, length, execute };
  };

  // --- 0x00-0x3F: loads, 16-bit arithmetic, inc/dec, rotates on A, relative jumps ---------
  op(0x00, 'NOP', 1, () => {});
  op(0x08, 'LD (a16),SP', 3, (cpu) => {
    const addr = cpu.fetch16();
    cpu.write8(addr, cpu.sp & 0xff);
    cpu.write8((addr + 1) & 0xffff, cpu.sp >> 8);
  });
  op(0x10, 'STOP', 2, (cpu) => cpu.stop());
  op(0x18, 'JR r8', 2, (cpu) => {
    const e = cpu.fetchOffset();
    cpu.internal();
    cpu.pc = (cpu.pc + e) & 0xffff;
  });
  for (let cc = 0; cc < 4; cc++) {
    op(0x20 | (cc << 3), `JR ${CC[cc]},r8`, 2, (cpu) => {
      const e = cpu.fetchOffset();
      if (!cpu.condition(cc)) return;
      cpu.internal();
      cpu.pc = (cpu.pc + e) & 0xffff;
    });
  }

  for (let p = 0; p < 4; p++) {
    op(0x01 | (p << 4), `LD ${RP[p]},d16`, 3, (cpu) => cpu.setRp(p, cpu.fetch16()));
    op(0x03 | (p << 4), `INC ${RP[p]}`, 1, (cpu) => {
      cpu.setRp(p, (cpu.getRp(p) + 1) & 0xffff);
      cpu.internal();
    });
    op(0x0b | (p << 4), `DEC ${RP[p]}`, 1, (cpu) => {
      cpu.setRp(p, (cpu.getRp(p) - 1) & 0xffff);
      cpu.internal();
    });
    op(0x09 | (p << 4), `ADD HL,${RP[p]}`, 1, (cpu) => cpu.addHl(cpu.getRp(p)));
  }

  op(0x02, 'LD (BC),A', 1, (cpu) => cpu.write8(cpu.bc, cpu.r[A]!));
  op(0x12, 'LD (DE),A', 1, (cpu) => cpu.write8(cpu.de, cpu.r[A]!));
  op(0x22, 'LD (HL+),A', 1, (cpu) => {
    const hl = cpu.hl;
    cpu.write8(hl, cpu.r[A]!);
    cpu.hl = (hl + 1) & 0xffff;
  });
  op(0x32, 'LD (HL-),A', 1, (cpu) => {
    const hl = cpu.hl;
    cpu.write8(hl, cpu.r[A]!);
    cpu.hl = (hl - 1) & 0xffff;
  });
  op(0x0a, 'LD A,(BC)', 1, (cpu) => {
    cpu.r[A] = cpu.read8(cpu.bc);
  });
  op(0x1a, 'LD A,(DE)', 1, (cpu) => {
    cpu.r[A] = cpu.read8(cpu.de);
  });
  op(0x2a, 'LD A,(HL+)', 1, (cpu) => {
    const hl = cpu.hl;
    cpu.r[A] = cpu.read8(hl);
    cpu.hl = (hl + 1) & 0xffff;
  });
  op(0x3a, 'LD A,(HL-)', 1, (cpu) => {
    const hl = cpu.hl;
    cpu.r[A] = cpu.read8(hl);
    cpu.hl = (hl - 1) & 0xffff;
  });

  for (let y = 0; y < 8; y++) {
    const name = R8_NAMES[y];
    op(0x04 | (y << 3), `INC ${name}`, 1, (cpu) => cpu.setR8(y, cpu.inc8(cpu.getR8(y))));
    op(0x05 | (y << 3), `DEC ${name}`, 1, (cpu) => cpu.setR8(y, cpu.dec8(cpu.getR8(y))));
    op(0x06 | (y << 3), `LD ${name},d8`, 2, (cpu) => cpu.setR8(y, cpu.fetch8()));
  }

  // Accumulator rotates always clear Z, unlike their CB counterparts.
  op(0x07, 'RLCA', 1, (cpu) => {
    cpu.r[A] = cpu.rlc(cpu.r[A]!);
    cpu.r[F] = cpu.r[F]! & ~FLAG_Z;
  });
  op(0x0f, 'RRCA', 1, (cpu) => {
    cpu.r[A] = cpu.rrc(cpu.r[A]!);
    cpu.r[F] = cpu.r[F]! & ~FLAG_Z;
  });
  op(0x17, 'RLA', 1, (cpu) => {
    cpu.r[A] = cpu.rl(cpu.r[A]!);
    cpu.r[F] = cpu.r[F]! & ~FLAG_Z;
  });
  op(0x1f, 'RRA', 1, (cpu) => {
    cpu.r[A] = cpu.rr(cpu.r[A]!);
    cpu.r[F] = cpu.r[F]! & ~FLAG_Z;
  });
  op(0x27, 'DAA', 1, (cpu) => cpu.daa());
  op(0x2f, 'CPL', 1, (cpu) => {
    cpu.r[A] = ~cpu.r[A]!;
    cpu.r[F] = cpu.r[F]! | FLAG_N | FLAG_H;
  });
  op(0x37, 'SCF', 1, (cpu) => {
    cpu.r[F] = (cpu.r[F]! & FLAG_Z) | FLAG_C;
  });
  op(0x3f, 'CCF', 1, (cpu) => {
    cpu.r[F] = (cpu.r[F]! & FLAG_Z) | ((cpu.r[F]! & FLAG_C) ^ FLAG_C);
  });

  // --- 0x40-0x7F: LD r,r' (0x76 is HALT) --------------------------------------------------
  for (let y = 0; y < 8; y++) {
    for (let z = 0; z < 8; z++) {
      const code = 0x40 | (y << 3) | z;
      const mnemonic = `LD ${R8_NAMES[y]},${R8_NAMES[z]}`;
      if (y === HL_INDIRECT || z === HL_INDIRECT) {
        op(code, mnemonic, 1, (cpu) => cpu.setR8(y, cpu.getR8(z)));
      } else {
        op(code, mnemonic, 1, (cpu) => {
          cpu.r[y] = cpu.r[z]!;
        });
      }
    }
  }
  op(0x76, 'HALT', 1, (cpu) => cpu.halt());

  // --- 0x80-0xBF: ALU A,r -----------------------------------------------------------------
  for (let y = 0; y < 8; y++) {
    const alu = ALU[y]!;
    for (let z = 0; z < 8; z++) {
      op(0x80 | (y << 3) | z, `${ALU_NAMES[y]}${R8_NAMES[z]}`, 1, (cpu) => alu(cpu, cpu.getR8(z)));
    }
    op(0xc6 | (y << 3), `${ALU_NAMES[y]}d8`, 2, (cpu) => alu(cpu, cpu.fetch8()));
  }

  // --- 0xC0-0xFF: stack, jumps, calls, high-page I/O, misc --------------------------------
  for (let cc = 0; cc < 4; cc++) {
    op(0xc0 | (cc << 3), `RET ${CC[cc]}`, 1, (cpu) => {
      cpu.internal();
      if (!cpu.condition(cc)) return;
      cpu.pc = cpu.pop16();
      cpu.internal();
    });
    op(0xc2 | (cc << 3), `JP ${CC[cc]},a16`, 3, (cpu) => {
      const addr = cpu.fetch16();
      if (!cpu.condition(cc)) return;
      cpu.internal();
      cpu.pc = addr;
    });
    op(0xc4 | (cc << 3), `CALL ${CC[cc]},a16`, 3, (cpu) => {
      const addr = cpu.fetch16();
      if (!cpu.condition(cc)) return;
      cpu.push16(cpu.pc);
      cpu.pc = addr;
    });
  }
  for (let p = 0; p < 4; p++) {
    op(0xc1 | (p << 4), `POP ${RP2[p]}`, 1, (cpu) => cpu.setRp2(p, cpu.pop16()));
    op(0xc5 | (p << 4), `PUSH ${RP2[p]}`, 1, (cpu) => cpu.push16(cpu.getRp2(p)));
  }
  for (let y = 0; y < 8; y++) {
    const target = y * 8;
    op(0xc7 | (y << 3), `RST ${target.toString(16).toUpperCase().padStart(2, '0')}H`, 1, (cpu) => {
      cpu.push16(cpu.pc);
      cpu.pc = target;
    });
  }

  op(0xc3, 'JP a16', 3, (cpu) => {
    const addr = cpu.fetch16();
    cpu.internal();
    cpu.pc = addr;
  });
  op(0xe9, 'JP HL', 1, (cpu) => {
    cpu.pc = cpu.hl;
  });
  op(0xcd, 'CALL a16', 3, (cpu) => {
    const addr = cpu.fetch16();
    cpu.push16(cpu.pc);
    cpu.pc = addr;
  });
  op(0xc9, 'RET', 1, (cpu) => {
    cpu.pc = cpu.pop16();
    cpu.internal();
  });
  op(0xd9, 'RETI', 1, (cpu) => {
    cpu.pc = cpu.pop16();
    cpu.internal();
    cpu.ime = true;
  });
  op(0xcb, 'PREFIX CB', 2, (cpu) => cpu.executeCb());

  op(0xe0, 'LDH (a8),A', 2, (cpu) => cpu.write8(0xff00 | cpu.fetch8(), cpu.r[A]!));
  op(0xf0, 'LDH A,(a8)', 2, (cpu) => {
    cpu.r[A] = cpu.read8(0xff00 | cpu.fetch8());
  });
  op(0xe2, 'LD (C),A', 1, (cpu) => cpu.write8(0xff00 | cpu.r[C]!, cpu.r[A]!));
  op(0xf2, 'LD A,(C)', 1, (cpu) => {
    cpu.r[A] = cpu.read8(0xff00 | cpu.r[C]!);
  });
  op(0xea, 'LD (a16),A', 3, (cpu) => cpu.write8(cpu.fetch16(), cpu.r[A]!));
  op(0xfa, 'LD A,(a16)', 3, (cpu) => {
    cpu.r[A] = cpu.read8(cpu.fetch16());
  });

  op(0xe8, 'ADD SP,r8', 2, (cpu) => {
    const result = cpu.addSpOffset(cpu.fetchOffset());
    cpu.internal();
    cpu.internal();
    cpu.sp = result;
  });
  op(0xf8, 'LD HL,SP+r8', 2, (cpu) => {
    cpu.hl = cpu.addSpOffset(cpu.fetchOffset());
    cpu.internal();
  });
  op(0xf9, 'LD SP,HL', 1, (cpu) => {
    cpu.sp = cpu.hl;
    cpu.internal();
  });

  op(0xf3, 'DI', 1, (cpu) => cpu.disableInterrupts());
  op(0xfb, 'EI', 1, (cpu) => cpu.enableInterrupts());

  return table;
}
