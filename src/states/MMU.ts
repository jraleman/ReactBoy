const mmu = {
    // Read 8-bit byte from a given address
    rb: (addr) => { console.log('rb: ', addr) },
    // Read 16-bit word from a given address
    rw: (addr) => { console.log('rw: ', addr) },
    // Write 8-bit byte to a given address
    wb: (addr, val) => { console.log('wb: ', addr, val) },
    // Write 16-bit word to a given address
    ww: (addr, val) => { console.log('ww: ', addr, val) }
};

const MMU = { ...mmu };

export default MMU;
