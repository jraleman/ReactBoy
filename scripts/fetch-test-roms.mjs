#!/usr/bin/env node
// Downloads the open test ROMs used by the conformance suite into roms/test/.
// They are fetched on demand (and cached in CI) instead of being committed.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'roms', 'test');

const BLARGG = 'https://raw.githubusercontent.com/retrio/gb-test-roms/master';
const ACID2 = 'https://github.com/mattcurrie/dmg-acid2';

const blargg = [
  'cpu_instrs/individual/01-special.gb',
  'cpu_instrs/individual/02-interrupts.gb',
  'cpu_instrs/individual/03-op sp,hl.gb',
  'cpu_instrs/individual/04-op r,imm.gb',
  'cpu_instrs/individual/05-op rp.gb',
  'cpu_instrs/individual/06-ld r,r.gb',
  'cpu_instrs/individual/07-jr,jp,call,ret,rst.gb',
  'cpu_instrs/individual/08-misc instrs.gb',
  'cpu_instrs/individual/09-op r,r.gb',
  'cpu_instrs/individual/10-bit ops.gb',
  'cpu_instrs/individual/11-op a,(hl).gb',
  'cpu_instrs/cpu_instrs.gb',
  'instr_timing/instr_timing.gb',
  'mem_timing/individual/01-read_timing.gb',
  'mem_timing/individual/02-write_timing.gb',
  'mem_timing/individual/03-modify_timing.gb',
  ...[
    '01-registers',
    '02-len ctr',
    '03-trigger',
    '04-sweep',
    '05-sweep details',
    '06-overflow on trigger',
    '07-len sweep period sync',
    '08-len ctr during power',
    '09-wave read while on',
    '10-wave trigger while on',
    '11-regs after power',
    '12-wave write while on',
  ].map((name) => `dmg_sound/rom_singles/${name}.gb`),
];

const files = [
  ...blargg.map((path) => ({ url: `${BLARGG}/${encodeURI(path)}`, dest: join('blargg', path) })),
  { url: `${ACID2}/releases/download/v1.0/dmg-acid2.gb`, dest: 'dmg-acid2/dmg-acid2.gb' },
  { url: `${ACID2}/raw/master/img/reference-dmg.png`, dest: 'dmg-acid2/reference-dmg.png' },
];

const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

let fetched = 0;
for (const { url, dest } of files) {
  const target = join(root, dest);
  if (await exists(target)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(await res.arrayBuffer()));
  fetched++;
  console.log(`fetched ${dest}`);
}
console.log(
  `test ROMs ready in roms/test (${fetched} downloaded, ${files.length - fetched} cached)`,
);
