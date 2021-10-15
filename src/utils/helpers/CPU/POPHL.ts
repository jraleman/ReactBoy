// @ts-nocheck
// Pop registers H and L off the stack (POP HL)
const POPHL = (mmu) => {
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

export default POPHL;
