// Real WASM + guest CPU/PPU/APU + matrix bus acceptance checks.
// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { create, browserCodeToRetroKey, JOYPAD } = await import(new URL('../web/public/cores/fceumm.js', import.meta.url));
const evidenceOption = process.argv.indexOf('--evidence');
const evidence = evidenceOption < 0 ? join(project, 'build/20261121-core-01/emulator') : resolve(process.argv[evidenceOption + 1]);
await mkdir(evidence, { recursive: evidenceOption < 0 });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = { runtime: '', matrix: [], roms: [], checks: [] };
let sampleCount = 0, nonzeroSamples = 0;
const emulator = await create({ audio: false, onAudio: ({ samples, sampleRate }) => {
  assert.equal(sampleRate, 48000);
  sampleCount += samples.length;
  for (const value of samples) if (value !== 0) nonzeroSamples++;
} });
results.runtime = emulator.version;
const diagnostic = new Uint8Array(await readFile(join(project, 'emulator/diagnostics/matrix-diagnostic.nes')));
emulator.loadRom(diagnostic);
function run(count = 3) { let frame; for (let i = 0; i < count; i++) frame = emulator.runFrame(); return frame; }
function matrix() { return [...emulator.getSystemRAM().slice(0x400, 0x41A)]; }
const blank = Array(26).fill(30);
for (const device of ['family', 'subor']) {
  emulator.setKeyboardDevice(device);
  run();
  assert.deepEqual(matrix(), blank, `${device}: no keys`);
  const cases = device === 'family' ? [
    ['KeyA', 6, 0, 4], ['Backquote', 1, 0, 1], ['Semicolon', 1, 0, 3],
    ['Quote', 1, 0, 2], ['BracketLeft', 0, 0, 2], ['BracketRight', 0, 0, 3],
    ['Backslash', 0, 1, 2], ['Comma', 2, 1, 1], ['Period', 2, 1, 0],
    ['Slash', 1, 1, 1], ['Enter', 0, 0, 1], ['ShiftLeft', 7, 1, 0],
    ['ShiftRight', 0, 1, 1], ['ControlLeft', 7, 0, 3], ['AltLeft', 7, 1, 1],
    ['AltRight', 1, 1, 0], ['ArrowUp', 8, 0, 1], ['F8', 0, 0, 0],
  ] : [
    ['KeyA', 5, 1, 1], ['Backquote', 12, 0, 0], ['Pause', 12, 0, 2],
    ['NumLock', 11, 1, 3], ['NumpadEnter', 9, 0, 1],
    ['Semicolon', 7, 0, 1], ['Quote', 7, 0, 2], ['BracketLeft', 4, 1, 1],
    ['BracketRight', 4, 0, 0], ['Backslash', 4, 1, 2], ['Comma', 3, 0, 3],
    ['Period', 3, 1, 3], ['Slash', 7, 0, 3], ['Enter', 4, 0, 1],
    ['ShiftLeft', 7, 1, 3], ['ControlLeft', 5, 1, 3], ['AltLeft', 10, 0, 0],
    ['ArrowUp', 4, 0, 2], ['F12', 10, 1, 0], ['NumpadDivide', 11, 1, 2],
  ];
  const combined = blank.slice();
  for (const [code, row, col, bitGiven] of cases) {
    const bit = bitGiven === 4 ? 3 : bitGiven; // A is matrix bit 3 in Family.
    const key = browserCodeToRetroKey(code);
    assert.notEqual(key, null, code);
    emulator.setKey(key, true);
    run();
    const expected = blank.slice();
    for (let rowIndex = row; rowIndex < 13; rowIndex += device === 'family' ? 9 : 13) {
      expected[rowIndex * 2 + col] &= ~(1 << (bit + 1));
      combined[rowIndex * 2 + col] &= ~(1 << (bit + 1));
    }
    assert.deepEqual(matrix(), expected, `${device} ${code} reads actual $4017 matrix`);
    emulator.setKey(key, false);
    run();
    assert.deepEqual(matrix(), blank, `${device} ${code} release`);
    results.matrix.push({ device, code, row, column: col, bit: bit + 1, pass: true });
  }
  for (const [code] of cases) emulator.setKey(browserCodeToRetroKey(code), true);
  run();
  assert.deepEqual(matrix(), combined, `${device} punctuation/modifiers chord`);
  emulator.releaseAll();
  run();
  assert.deepEqual(matrix(), blank, `${device} releaseAll clears chord`);
  assert.equal(emulator.getDiagnostics().keyboardPolls, device === 'family' ? 72 : 101);
}
results.checks.push('Family 18 keys and Subor 20 keys: each press/release, chords, all 26 guest matrix bytes and polling counts');
emulator.setKeyboardDevice('family');
emulator.setKey(97, true);
run();
assert.notDeepEqual(matrix(), blank);
emulator.setKeyboardDevice('subor');
run();
assert.deepEqual(matrix(), blank, 'device switch releases held key');
emulator.setKey(97, true);
run();
emulator.setKeyboardDevice('none');
run();
assert.equal(emulator.getDiagnostics().keyboardPolls, 0);
results.checks.push('device switching clears input; none disables keyboard polling');
for (const [player, button, expected] of [[0, JOYPAD.A, 128], [0, JOYPAD.B, 64], [0, JOYPAD.START, 16], [1, JOYPAD.RIGHT, 1]]) {
  emulator.setButton(player, button, true);
  run();
  assert.equal(emulator.getSystemRAM()[0x420 + player], expected);
  emulator.releaseAll();
  run();
  assert.equal(emulator.getSystemRAM()[0x420 + player], 0);
}
results.checks.push('player 1 A/B/Start and player 2 Right read from guest $4016/$4017 serial ports');
const sram = emulator.getSaveRAM();
assert.equal(sram.length, 8192);
for (let i = 0; i < sram.length; i++) sram[i] = (i * 37 + 19) & 255;
assert(emulator.loadSaveRAM(sram));
assert.deepEqual(emulator.getSaveRAM(), sram);
assert.equal(emulator.loadSaveRAM(new Uint8Array(3)), false);
const snapshot = emulator.getState();
emulator.loadSaveRAM(new Uint8Array(8192));
run(11);
assert(emulator.loadState(snapshot));
assert.deepEqual(emulator.getSaveRAM(), sram, 'snapshot restores mapped SRAM');
const state1 = emulator.getState();
assert.equal(hash(state1), hash(snapshot));
emulator.setVolume(0.25);
assert.equal(emulator.getDiagnostics().volume, 0.25);
results.checks.push(`8192-byte SRAM patterned round trip, wrong length rejected, ${snapshot.length}-byte snapshot restores SRAM and exact state bytes`);
await writeFile(join(evidence, 'diagnostic-state.bin'), snapshot);
// Execute the released upstream KeyTest ROM too, without deriving its behavior from our scanner.
const keytest = new Uint8Array(await readFile(join(project, 'emulator/diagnostics/keytest/keytest.nes')));
emulator.loadRom(keytest);
emulator.setKeyboardDevice('family');
let keytestFrame = run(180);
assert(keytestFrame.data.some((v, i) => i % 4 !== 3 && v > 0));
results.checks.push('unmodified upstream KeyTest release runs 180 real PPU frames');
async function romFiles(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, item.name);
    if (item.isDirectory()) files.push(...await romFiles(path));
    else if (/\.nes$/i.test(item.name)) files.push(path);
  }
  return files;
}
let romPaths = process.argv.slice(2);
if (evidenceOption >= 0) romPaths.splice(evidenceOption - 2, 2);
const catalogPath = join(project, 'web/public/games/catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8').catch(() => '{"games":[]}'));
const expectedROMs = new Map(catalog.games.map(game => [join(project, 'web/public/games', game.filename), game]));
if (!romPaths.length && catalog.games.length) romPaths = [...expectedROMs.keys()];
if (!romPaths.length) romPaths = await romFiles(join(project, 'build/20261121-core-01/downloads'));
for (const path of romPaths) {
  const bytes = new Uint8Array(await readFile(path));
  const catalogGame = expectedROMs.get(path);
  if (catalogGame) assert.equal(hash(bytes), catalogGame.sha256, 'catalog ROM checksum');
  sampleCount = nonzeroSamples = 0;
  emulator.setKeyboardDevice('none');
  emulator.loadRom(bytes);
  let frame = run(120);
  emulator.setButton(0, JOYPAD.START, true); run(4); emulator.releaseAll();
  frame = run(116);
  assert.equal(frame.width, 256);
  assert.equal(frame.data.length, frame.width * frame.height * 4);
  assert(sampleCount > 100000);
  assert(frame.data.some((v, i) => i % 4 !== 3 && v > 0));
  const saved = emulator.getState();
  const expectedFrame = run();
  assert(emulator.loadState(saved));
  const restoredFrame = run();
  assert.equal(hash(restoredFrame.data), hash(expectedFrame.data), 'deterministic frame after state restore');
  results.roms.push({ id: catalogGame?.id ?? null, path, romSHA256: hash(bytes), frames: 240, width: frame.width, height: frame.height, audioSamples: sampleCount, nonzeroSamples, stateBytes: saved.length, frameSHA256: hash(frame.data), deterministicState: true });
}
await emulator.destroy();
assert.throws(() => emulator.runFrame(), /destroyed/);
results.checks.push('destroy is final and rejects later frame calls');
await writeFile(join(evidence, 'smoke-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
