// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise actual core snapshots across HTTP, SQLite reopen and backup restore.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = JSON.parse(await readFile(join(root, 'branding/brand.json'), 'utf8')).version;
const catalog = JSON.parse(await readFile(join(root, 'web/public/games/catalog.json'), 'utf8'));
assert(catalog.games.length >= 5 && catalog.games.length <= 8, 'Bundled catalog stays within the agreed range');
const binary = process.argv[2];
const output = resolve(process.argv[3]);
assert(binary, 'Pass the built application binary and a new evidence directory.');
const expectedBuildId = basename(dirname(resolve(binary)));
await mkdir(output, { recursive: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = `xnbw-roundtrip-${hash(output).slice(0, 16)}`;
const report = { status: 'running', checks: [], failures: [], scope: 'local HTTP, actual WASM and SQLite; no physical NAS or mobile hardware' };
const processes = new Set();
const check = (name, details) => report.checks.push({ name, pass: true, details });
const saveReport = () => writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
let emulator;
const ownedPorts = new Map();
async function availablePort() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function start(name) {
  const port = ownedPorts.get(name) ?? await availablePort();
  ownedPorts.set(name, port);
  const proc = spawn(binary, ['--listen', `127.0.0.1:${port}`, '--dev-user', marker,
    '--data-dir', join(output, `${name}-data`), '--web-root', join(root, 'web/dist'),
    '--bundled-root', join(root, 'web/public/games')], { stdio: ['ignore', 'pipe', 'pipe'] });
  processes.add(proc);
  let log = '';
  proc.stdout.on('data', data => { log += data; });
  proc.stderr.on('data', data => { log += data; });
  proc.on('close', () => { void writeFile(join(output, `${name}-server.log`), log); processes.delete(proc); });
  const base = `http://127.0.0.1:${port}`;
  for (let retry = 0; retry < 100; retry++) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${log}`);
    try {
      const response = await fetch(`${base}/api/health`, { headers: { 'X-XNBW-Test-User': marker } });
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.authenticated, true, 'Readiness must belong to this test identity');
        assert.equal(health.version, expectedVersion);
        assert.equal(health.ok, true);
        assert.equal(health.mode, 'local');
        assert.equal(health.buildId, expectedBuildId, 'Readiness must belong to the exact compiled build');
        assert.equal(proc.exitCode, null, 'Owned test process must remain alive');
        return { proc, base, buildId: health.buildId };
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await new Promise(done => setTimeout(done, 50));
  }
  throw new Error(`Server readiness timed out: ${log}`);
}
async function stop(server) {
  if (server.proc.exitCode !== null) return;
  const exited = once(server.proc, 'exit');
  server.proc.kill('SIGTERM');
  const [code] = await exited;
  assert.equal(code, 0, 'Graceful service stop');
}
async function request(server, path, init = {}, expected = 200) {
  const headers = new Headers(init.headers);
  headers.set('X-XNBW-Test-User', marker);
  const response = await fetch(`${server.base}/api${path}`, { ...init, headers });
  if (response.status !== expected) throw new Error(`${init.method || 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response;
}
async function json(server, path, init, expected) {
  return (await request(server, path, init, expected)).json();
}
const mutation = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function uploadROM(server, bytes, title) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), 'roundtrip.nes');
  form.append('title', title);
  return (await json(server, '/games', { method: 'POST', body: form }, 201)).game;
}
async function uploadSave(server, game, kind, bytes, slot = 1) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ gameId: game.id, kind, slot: kind === 'sram' ? 0 : slot,
    core: 'fceumm', coreVersion: 'fceumm-77468e568d9fe9c48d684ca911f1a3fe7259fdf7+xnbw-keyboard.1',
    romSha256: game.sha256, sha256: hash(bytes) })) form.append(key, String(value));
  form.append('file', new Blob([bytes]), 'snapshot.bin');
  return json(server, '/saves', { method: 'POST', body: form }, 201);
}
try {
  let source = await start('source');
  const health = await json(source, '/health');
  assert.equal(health.version, expectedVersion);
  assert.equal(health.core.available, true);
  const library = await json(source, '/library');
  assert.equal(library.games.length, catalog.games.length);
  assert.deepEqual(library.games.map(game => game.id).sort(), catalog.games.map(game => game.id).sort());
  for (const expected of catalog.games) {
    const game = library.games.find(item => item.id === expected.id);
    assert.equal(game.source, 'bundled');
    assert.equal(game.sha256, expected.sha256);
    const rom = new Uint8Array(await (await request(source, `/games/${game.id}/launch`)).arrayBuffer());
    assert.equal(hash(rom), expected.sha256);
  }
  check('目录中全部真实内置卡带、ROM 摘要和已构建核心均可用', { count: catalog.games.length, version: health.version });
  const unauthorized = await fetch(`${source.base}/api/games`);
  assert.equal(unauthorized.status, 401);
  const forged = await fetch(`${source.base}/api/games`, { headers: { 'X-Trim-Userid': '1000' } });
  assert.equal(forged.status, 401);
  const nas = await request(source, '/nas/roots', {}, 503);
  assert.match((await nas.json()).code, /nas_unavailable/);
  check('本地身份隔离与真实 NAS 不可用状态', { anonymous: 401, forgedGateway: 401, localNAS: 503 });
  const cargo = new Uint8Array(await readFile(join(root, 'web/public/games/cargo-shift.nes')));
  const game = await uploadROM(source, cargo, '端到端存档验证');
  assert.equal(game.source, 'imported');
  assert.equal(game.sha256, hash(cargo));
  const renamed = await json(source, `/games/${game.id}`, mutation('PUT', { title: '中文进度验证' }));
  assert.equal(renamed.title, '中文进度验证');
  await json(source, `/games/${game.id}/favorite`, mutation('PUT', { favorite: true }));
  await json(source, `/games/${game.id}/launch`, { method: 'POST' });
  const repeated = await uploadROM(source, cargo, '重复上传');
  assert.equal(repeated.id, game.id);
  check('合法 ROM 上传、中文改名、收藏、最近游玩和内容去重', { gameSHA256: game.sha256 });
  const { create, JOYPAD } = await import('../web/public/cores/fceumm.js');
  emulator = await create({ audio: false });
  emulator.loadRom(cargo);
  for (let i = 0; i < 120; i++) emulator.runFrame();
  emulator.setButton(0, JOYPAD.START, true);
  for (let i = 0; i < 4; i++) emulator.runFrame();
  emulator.releaseAll();
  for (let i = 0; i < 116; i++) emulator.runFrame();
  const state = emulator.getState();
  const before = emulator.runFrame();
  const frameDigest = hash(before.data);
  assert(emulator.loadState(state));
  assert.equal(hash(emulator.runFrame().data), frameDigest);
  const stored = await uploadSave(source, game, 'state', state);
  const downloaded = new Uint8Array(await (await request(source, `/saves/${stored.id}`)).arrayBuffer());
  assert.deepEqual(downloaded, state);
  assert(emulator.loadState(downloaded));
  assert.equal(hash(emulator.runFrame().data), frameDigest);
  await writeFile(join(output, 'actual-cargo.state'), state);
  check('真实核心即时存档经 HTTP 与 SQLite 后逐字节恢复', { bytes: state.length, sha256: hash(state), frameSHA256: frameDigest });
  const put = { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': stored.etag }, body: state };
  const updated = await json(source, `/saves/${stored.id}`, put);
  assert.equal(updated.version, 2);
  const conflict = await json(source, `/saves/${stored.id}`, put, 412);
  assert.equal(conflict.current.version, 2);
  const wrong = await json(source, `/saves/${stored.id}`, {
    ...put, headers: { ...put.headers, 'If-Match': updated.etag, 'X-XNBW-ROM-SHA256': '0'.repeat(64) },
  }, 409);
  assert(wrong.code);
  check('过期 ETag 与错误 ROM 关联被拒绝且保留服务器版本', { staleStatus: 412, incompatibleStatus: 409 });
  const builtin = library.games.find(g => g.id === 'cargo-shift' && g.source === 'bundled');
  assert(builtin);
  for (let i = 0; i < 60; i++) emulator.runFrame();
  const builtinState = emulator.getState();
  assert.notEqual(hash(builtinState), hash(state));
  const builtinStored = await uploadSave(source, builtin, 'state', builtinState);
  assert.equal(builtinStored.slot, stored.slot);
  assert.notEqual(builtinStored.gameId, stored.gameId);
  check('同一 ROM 的内置与个人导入条目在槽位 1 分别保存不同真实快照', {
    builtinGame: builtin.id, importedGame: game.id, builtinSHA256: hash(builtinState), importedSHA256: hash(state),
  });
  const diagnostic = new Uint8Array(await readFile(join(root, 'emulator/diagnostics/matrix-diagnostic.nes')));
  const diagnosticGame = await uploadROM(source, diagnostic, '键盘矩阵诊断');
  emulator.loadRom(diagnostic);
  emulator.runFrame();
  const ram = emulator.getSaveRAM();
  assert.equal(ram.length, 8192);
  for (let i = 0; i < ram.length; i++) ram[i] = (i * 37 + 19) & 255;
  assert(emulator.loadSaveRAM(ram));
  const ramMeta = await uploadSave(source, diagnosticGame, 'sram', ram);
  const ramDownload = new Uint8Array(await (await request(source, `/saves/${ramMeta.id}`)).arrayBuffer());
  assert.deepEqual(ramDownload, ram);
  check('真实诊断卡的 8 KiB SRAM 经服务器往返', { bytes: ram.length, sha256: hash(ram) });
  await json(source, '/settings', mutation('PUT', { volume: 0.35, pixelated: true, roundtripLabel: '中文设置' }));
  await stop(source);
  source = await start('source');
  const reopened = await json(source, `/games/${game.id}`);
  assert.equal(reopened.title, '中文进度验证');
  assert.equal(reopened.favorite, true);
  assert(reopened.lastPlayedAt);
  assert.equal((await json(source, '/settings')).roundtripLabel, '中文设置');
  assert.deepEqual(new Uint8Array(await (await request(source, `/saves/${stored.id}`)).arrayBuffer()), state);
  check('SIGTERM 后重新打开数据库，ROM/设置/收藏/最近记录/存档均保留');
  const archive = new Uint8Array(await (await request(source, '/backup')).arrayBuffer());
  assert.equal(archive[0], 0x50); assert.equal(archive[1], 0x4b);
  await writeFile(join(output, 'actual-backup.zip'), archive);
  const destination = await start('destination');
  assert.equal(destination.buildId, source.buildId, 'Both independent databases use the same compiled build');
  const form = new FormData(); form.append('file', new Blob([archive]), 'backup.zip');
  const restored = await json(destination, '/backup/restore', { method: 'POST', body: form });
  assert.equal(restored.importedGames, 2, 'Imported entries retain their identity even when the ROM is also bundled');
  assert.equal(restored.restoredSaves, 3);
  const restoredLibrary = await json(destination, '/library');
  const restoredGame = restoredLibrary.games.find(g => g.source === 'imported' && g.sha256 === game.sha256);
  assert(restoredGame);
  assert.equal(restoredGame.title, '中文进度验证');
  assert.equal(restoredGame.favorite, true);
  assert.equal(restoredGame.lastPlayedAt, reopened.lastPlayedAt);
  const restoredBuiltin = restoredLibrary.games.find(g => g.id === builtin.id && g.source === 'bundled');
  assert(restoredBuiltin);
  assert.notEqual(restoredBuiltin.id, restoredGame.id);
  assert.equal(restoredBuiltin.title, builtin.title);
  assert.equal(restoredBuiltin.favorite, false);
  const builtinSlots = (await json(destination, `/saves?game=${restoredBuiltin.id}`)).saves;
  assert.equal(builtinSlots.length, 1);
  assert.equal(builtinSlots[0].slot, stored.slot);
  assert.deepEqual(new Uint8Array(await (await request(destination, `/saves/${builtinSlots[0].id}`)).arrayBuffer()), builtinState);
  const restoredState = (await json(destination, `/saves?game=${restoredGame.id}`)).saves.find(s => s.kind === 'state');
  const restoredBytes = new Uint8Array(await (await request(destination, `/saves/${restoredState.id}`)).arrayBuffer());
  assert.deepEqual(restoredBytes, state);
  emulator.loadRom(cargo);
  assert(emulator.loadState(restoredBytes));
  assert.equal(hash(emulator.runFrame().data), frameDigest);
  const restoredDiagnostic = restoredLibrary.games.find(g => g.source === 'imported' && g.sha256 === diagnosticGame.sha256);
  const restoredRAMMeta = (await json(destination, `/saves?game=${restoredDiagnostic.id}`)).saves.find(s => s.kind === 'sram');
  assert.deepEqual(new Uint8Array(await (await request(destination, `/saves/${restoredRAMMeta.id}`)).arrayBuffer()), ram);
  assert.equal((await json(destination, '/settings')).roundtripLabel, '中文设置');
  check('完整 ZIP 在全新服务恢复，真实 state/SRAM 及中文设置、收藏、最近记录均恢复', { archiveBytes: archive.length, archiveSHA256: hash(archive), restored });
  const againForm = new FormData(); againForm.append('file', new Blob([archive]), 'backup.zip');
  const again = await json(destination, '/backup/restore', { method: 'POST', body: againForm });
  assert.equal(again.importedGames, 0);
  assert.equal(again.restoredSaves, 0);
  assert.equal(again.conflicts.filter(c => c.kind === 'save').length, 3);
  assert.deepEqual(new Uint8Array(await (await request(destination, `/saves/${builtinSlots[0].id}`)).arrayBuffer()), builtinState);
  assert.deepEqual(new Uint8Array(await (await request(destination, `/saves/${restoredState.id}`)).arrayBuffer()), state);
  check('重复恢复保留内置与个人条目的同号槽位，并返回三条存档冲突', { conflicts: again.conflicts.length });
  await stop(source); await stop(destination);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failures.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  if (emulator) await emulator.destroy();
  for (const proc of processes) proc.kill('SIGTERM');
  await saveReport();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failures: report.failures, evidence: output }, null, 2));
}
