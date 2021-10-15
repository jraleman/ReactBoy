// Push registers B and C to the stack (PUSH BC)
const PUSHBC = (mmu) => {
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

export default PUSHBC;
