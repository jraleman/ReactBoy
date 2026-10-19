/**
 * Indices into the CPU's 8-bit register file. B..L and A follow the SM83 opcode encoding
 * (0-5 and 7); encoding slot 6 means "(HL)", so F is stored there.
 */
export const B = 0;
export const C = 1;
export const D = 2;
export const E = 3;
export const H = 4;
export const L = 5;
export const F = 6;
export const A = 7;

/** Operand slot that refers to memory at HL rather than a register. */
export const HL_INDIRECT = 6;

export const FLAG_Z = 0x80;
export const FLAG_N = 0x40;
export const FLAG_H = 0x20;
export const FLAG_C = 0x10;
