// Seven-game catalog regression and actual FCEUmm WASM smoke checks.
// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = process.argv[2] ? resolve(process.argv[2]) : join(project, 'build/20261123-games-01');
await mkdir(evidence, { recursive: !process.argv[2] });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
const catalog = JSON.parse(await readFile(join(project, 'web/public/games/catalog.json'), 'utf8'));
const provenance = JSON.parse(await readFile(join(project, 'third_party/games/provenance.json'), 'utf8'));
const ids = ['table-tennis', 'lan-master', 'lawn-mower', 'void-lancer', 'cargo-shift', 'thwaite', 'croom'];
assert.deepEqual(catalog.games.map(game => game.id), ids);
assert.deepEqual(provenance.games.map(game => game.id), ids);
assert.equal(hash(JSON.stringify(sorted(catalog.games.slice(0, 5)))), '15523f731275353ed51f35b1d34c29026d9a7ee95cfb44f3eb53fcd4e1521464', 'original five catalog entries preserved');
assert.equal(hash(JSON.stringify(sorted(provenance.games.slice(0, 5)))), 'fc842dd81048a6a191097ad97cdb8d137cf7a850680f8ee20b5f26b0071aa74e', 'original five provenance records preserved');
for (const game of provenance.games) {
  const item = catalog.games.find(item => item.id === game.id);
  const bytes = await readFile(join(project, game.rom.path));
  assert.equal(hash(bytes), game.rom.sha256);
  assert.equal(hash(bytes), item.sha256);
  assert.equal(bytes.length, game.rom.size);
  assert.equal(bytes.subarray(0, 4).toString('hex'), '4e45531a');
  assert.equal(game.rom.mapper, 0);
  assert.equal(item.romTranslated, false);
  assert.equal(item.metadataLanguage, 'zh-CN');
  for (const snapshot of game.snapshots) {
    const bytes = await readFile(join(project, snapshot.path));
    assert.equal(hash(bytes), snapshot.sha256);
    assert.equal(bytes.length, snapshot.size);
  }
  const notice = await readFile(join(project, game.permission.publicNotice.path));
  assert.equal(hash(notice), game.permission.publicNotice.sha256);
  if (!['thwaite', 'croom'].includes(game.id)) continue;
  assert.equal(item.language, 'en');
  assert.equal(item.license, 'GPL-3.0-or-later');
  assert.equal(game.permission.correspondingSourceIncluded, true);
  assert.equal(game.permission.sourceIncludesBuildArtMusic, true);
  assert.equal(game.permission.sourceFreeDistributionClaimed, false);
  assert(notice.includes(Buffer.from(game.permission.verbatimWholeProgramGrant)));
  assert(notice.includes(Buffer.from('Version 3, 29 June 2007')));
  assert(notice.includes(Buffer.from('END OF TERMS AND CONDITIONS')));
  assert(game.evidence.some(entry => entry.archiveMember.endsWith('/makefile')));
  assert(game.evidence.some(entry => entry.archiveMember.endsWith('/src/musicseq.s')));
  assert(game.evidence.some(entry => entry.archiveMember.includes('/tilesets/')));
  if (game.id === 'croom') {
    assert(notice.includes(Buffer.from('as published by Damian Yerrick, in iNES or UNIF executable form without source code')));
    assert(notice.includes(Buffer.from('and Sara Crickard')));
    assert.deepEqual(game.permission.credits.graphics, ['Damian Yerrick', 'Sara Crickard']);
  } else assert.equal(game.permission.exactPublishedRomException, null);
}

// Copy only vendored game resources and our preparation script: no original
// downloads, upstream execution, network fetch, or change to the project tree.
const offline = await mkdtemp(join(evidence, 'offline-'));
async function filesAt(root) {
  const result = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result[path.slice(root.length + 1)] = hash(await readFile(path));
    }
  }
  await walk(root);
  return result;
}
try {
  await mkdir(join(offline, 'scripts'), { recursive: true });
  await cp(join(project, 'scripts/prepare-games.py'), join(offline, 'scripts/prepare-games.py'));
  for (const path of ['third_party/games', 'web/public/games']) await cp(join(project, path), join(offline, path), { recursive: true });
  const before = await filesAt(offline);
  const prepare = (...args) => execFileSync('python3', ['-I', join(offline, 'scripts/prepare-games.py'), ...args], { encoding: 'utf8', cwd: tmpdir() });
  assert.match(prepare('--check'), /Validated 7 games.*no files written/);
  assert.match(prepare(), /0 files updated/);
  assert.match(prepare(), /0 files updated/);
  assert.deepEqual(await filesAt(offline), before, 'offline preparation leaves exact bytes stable');
} finally { await rm(offline, { recursive: true, force: true }); }

// Lossless diagnostic frame capture, not an upstream cover or a ROM patch.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, checksum]);
}
function png(frame) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(frame.width, 0); header.writeUInt32BE(frame.height, 4);
  header[8] = 8; header[9] = 6;
  const rows = [];
  for (let y = 0; y < frame.height; y++) rows.push(Buffer.from([0]), Buffer.from(frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4)));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir(evidence, { recursive: true });
const { create, JOYPAD } = await import(new URL('../web/public/cores/fceumm.js', import.meta.url));
const results = { schemaVersion: 1, runtime: '', runtimeModule: 'web/public/cores/fceumm.js', coreSHA256: hash(await readFile(join(project, 'web/public/cores/fceumm-core.wasm'))),
  catalogCount: catalog.games.length, originalFivePreserved: true, offlineStable: true, upstreamCodeExecuted: false,
  boundary: 'Actual WASM/CPU/PPU/APU headless smoke, digital gamepad API, exact state restore and next-frame determinism. No full-game completion, audible listening, browser hardware, source rebuild or battery-save claim.', games: [] };
for (const id of ['thwaite', 'croom']) {
  let audioSamples = 0, nonzeroSamples = 0, audioCallbacks = 0;
  const runtime = await create({ audio: false, onAudio: ({ samples, sampleRate, channels }) => {
    assert.equal(sampleRate, 48000); assert.equal(channels, 2); audioCallbacks++;
    audioSamples += samples.length;
    for (const value of samples) { assert(Number.isFinite(value)); if (value !== 0) nonzeroSamples++; }
  } });
  try {
    const game = catalog.games.find(game => game.id === id);
    const bytes = await readFile(join(project, 'web/public/games', game.filename));
    assert.equal(hash(bytes), game.sha256);
    runtime.setKeyboardDevice('none');
    runtime.loadRom(new Uint8Array(bytes));
    results.runtime = runtime.version;
    let executedFrames = 0;
    const run = (count = 1) => { let frame; for (let i = 0; i < count; i++) { frame = runtime.runFrame(); executedFrames++; } return frame; };
    const tap = button => { runtime.setButton(0, button, true); run(4); runtime.releaseAll(); return run(8); };
    let frame = run(120);
    await writeFile(join(evidence, `${id}-boot.png`), png(frame));
    if (id === 'thwaite') {
      tap(JOYPAD.START); // legal notice -> title
      run(30); tap(JOYPAD.START); // default single player
      run(180); tap(JOYPAD.START); // acknowledge introductory text if present
    } else {
      tap(JOYPAD.DOWN); // title: 1 Player Solitaire
      tap(JOYPAD.A); run(30); tap(JOYPAD.A); // confirm difficulty
      run(120); tap(JOYPAD.A);
    }
    frame = run(180);
    const saved = runtime.getState();
    const baseline = run(30);
    assert(runtime.loadState(saved));
    assert.equal(hash(runtime.getState()), hash(saved), 'exact state bytes after restore');
    runtime.setButton(0, JOYPAD.RIGHT, true); runtime.setButton(0, JOYPAD.A, true);
    const acted = run(30); runtime.releaseAll();
    assert.notEqual(hash(acted.data), hash(baseline.data), `${id}: gamepad action changes rendered frame from same-state baseline`);
    frame = run(30);
    assert.equal(frame.width, 256); assert([224, 240].includes(frame.height));
    assert(frame.data.some((v, index) => index % 4 !== 3 && v > 0));
    const state = runtime.getState();
    const next = run();
    assert(runtime.loadState(state));
    assert.equal(hash(runtime.getState()), hash(state));
    const restoredNext = run();
    assert.equal(hash(restoredNext.data), hash(next.data), 'exact next-frame determinism');
    assert(audioSamples > 100000); assert(nonzeroSamples > 0);
    const sram = runtime.getSaveRAM();
    assert.equal(sram.length, 0, 'no mapped battery SRAM in these NROM games');
    const screenshot = png(frame);
    await writeFile(join(evidence, `${id}-gamepad.png`), screenshot);
    const result = { id, romSHA256: hash(bytes), headerHex: bytes.subarray(0, 16).toString('hex'), mapper: 0, executedFrames,
      width: frame.width, height: frame.height, audioSamples, nonzeroSamples, audioCallbacks, sampleRate: runtime.sampleRate,
      stateBytes: state.length, stateSHA256: hash(state), exactStateRoundTrip: true, nextFrameDeterministic: true,
      gamepadActionChangesFrame: true, baselineFrameSHA256: hash(baseline.data), actedFrameSHA256: hash(acted.data),
      nextFrameSHA256: hash(next.data), saveRAMBytes: sram.length, screenshot: `${id}-gamepad.png`, screenshotSHA256: hash(screenshot) };
    results.games.push(result);
  } finally { await runtime.destroy(); }
}
await writeFile(join(evidence, 'game-catalog-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
