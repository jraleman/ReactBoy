// Instruction simulations

// ------------------------------------------------------------------------

// Add E to A, leaving result in A (ADD A, E)
export const ADDr_e = () => {
    // Perform addition
    this._r.a += this._r.e; 
    // Clear flags
    this._r.f = 0;
    // Check for zero
    if (!(this._r.a & 255)) {
        this._r.f |= 0x80;
    }
    // Check for carry
    if (this._r.a > 255) {
        this._r.f |= 0x10;
    }
    // Mask to 8-bits
    this._r.a &= 255;
    // 1 M-time taken
    this._r.m = 1;
    this._r.t = 4;
};

// Compare B to A, setting flags (CP A, B)
export const CPr_b = () => {
    // Temp copy of A
    let i = this._r.a;
    // Subtract B
    i -= this._r.b;
    // Set subtraction flag
    this._r.f |= 0x40;
    // Check for zero
    if (!(i & 255)) {
        this._r.f |= 0x80;
    }
    // Check for underflow
    if (i < 0) {
        this._r.f |= 0x10;
    }
    // 1 M-time taken
    this._r.m = 1; this._r.t = 4;
};

// No-operation (NOP)
export const NOP = () => {
    // 1 M-time taken
    this._r.m = 1; this._r.t = 4;                
};

// ------------------------------------------------------------------------

// Memory-handling instructions

// Push registers B and C to the stack (PUSH BC)
export const PUSHBC = (mmu) => {
    // Drop through the stack
    this._r.sp -= 1;
    // Write B
    mmu.wb(this._r.sp, this._r.b);
    // Drop through the stack
    this._r.sp -= 1;
    // Write C
    mmu.wb(this._r.sp, this._r.c);
    // 3 M-times taken
    this._r.m = 3; this._r.t = 12;
};

// Pop registers H and L off the stack (POP HL)
export const POPHL = (mmu) => {
    // Read L
    this._r.l = mmu.rb(this._r.sp);
    // Move back up the stack
    this._r.sp += 1;
    // Read H
    this._r.h = mmu.rb(this._r.sp);
    // Move back up the stack
    this._r.sp += 1;
    // 3 M-times taken
    this._r.m = 3; this._r.t = 12;
};

// Read a byte from absolute location into A (LD A, addr)
export const LDAmm = (mmu) => {
    // Get address from instr
    const addr = mmu.rw(this._r.pc);
    // Advance PC
    this._r.pc += 2;
    // Read from address
    this._r.a = mmu.rb(addr);
    // 4 M-times taken
    this._r.m = 4; this._r.t = 16;
};
