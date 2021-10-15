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
