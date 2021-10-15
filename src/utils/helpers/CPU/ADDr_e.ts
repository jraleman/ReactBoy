// Add E to A, leaving result in A (ADD A, E)
const ADDr_e = () => {
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

export default ADDr_e;
