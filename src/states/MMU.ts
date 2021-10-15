import rb from '../utils/helpers/MMU/rb';
import rw from '../utils/helpers/MMU/rw';
import wb from '../utils/helpers/MMU/wb';
import ww from '../utils/helpers/MMU/ww';

const mmu = {
    // Read 8-bit byte from a given address
    rb,
    // Read 16-bit word from a given address
    rw,
    // Write 8-bit byte to a given address
    wb,
    // Write 16-bit word to a given address
    ww,
};

const MMU = { ...mmu };

export default MMU;
