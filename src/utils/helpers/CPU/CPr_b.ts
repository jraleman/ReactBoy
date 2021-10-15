// Compare B to A, setting flags (CP A, B)
const CPr_b = () => {
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

export default CPr_b;
