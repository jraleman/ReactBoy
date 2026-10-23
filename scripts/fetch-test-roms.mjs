#!/usr/bin/env node
// Downloads the open test ROMs used by the conformance suite into roms/test/.
// They are fetched on demand (and cached in CI) instead of being committed.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'roms', 'test');

const BLARGG = 'https://raw.githubusercontent.com/retrio/gb-test-roms/master';
const ACID2 = 'https://github.com/mattcurrie/dmg-acid2';
const CGB_ACID2 = 'https://github.com/mattcurrie/cgb-acid2';
const MOONEYE_BUILD = 'mts-20260714-0944-31510e1';
const MOONEYE = `https://gekkio.fi/files/mooneye-test-suite/${MOONEYE_BUILD}/${MOONEYE_BUILD}.tar.gz`;

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
  { url: `${CGB_ACID2}/releases/download/v1.1/cgb-acid2.gbc`, dest: 'cgb-acid2/cgb-acid2.gbc' },
  { url: `${CGB_ACID2}/raw/master/img/reference.png`, dest: 'cgb-acid2/reference.png' },
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
// Mooneye only publishes whole-suite archives; keep the acceptance and MBC tests from one.
const mooneyeDir = join(root, 'mooneye');
const mooneyeStamp = join(mooneyeDir, `${MOONEYE_BUILD}.stamp`);
if (!(await exists(mooneyeStamp))) {
  const res = await fetch(MOONEYE);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${MOONEYE}`);
  let count = 0;
  for (const { name, data } of readTar(gunzipSync(new Uint8Array(await res.arrayBuffer())))) {
    const path = name.slice(name.indexOf('/') + 1);
    if (!/^(acceptance|emulator-only\/mbc\d)\/.*\.gb$/.test(path)) continue;
    const target = join(mooneyeDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    count++;
  }
  await writeFile(mooneyeStamp, '');
  console.log(`fetched ${count} Mooneye ROMs from ${MOONEYE_BUILD}`);
}

/** Regular files in a ustar archive. */
function* readTar(tar) {
  const text = (start, length) =>
    new TextDecoder().decode(tar.subarray(start, start + length)).replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const prefix = text(offset + 345, 155);
    const name = prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100);
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[offset + 156]);
    const start = offset + 512;
    if (type === '0' || type === '\0') yield { name, data: tar.subarray(start, start + size) };
    offset = start + Math.ceil(size / 512) * 512;
  }
}

console.log(
  `test ROMs ready in roms/test (${fetched} downloaded, ${files.length - fetched} cached)`,
);
