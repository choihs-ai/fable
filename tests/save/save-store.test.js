import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAVE } from '../../data/save.js';
import { getPlayer } from '../../src/logic/entities/actors.js';
import { createMeta } from '../../src/logic/items/meta.js';
import { readRun } from '../../src/logic/save/codec.js';
import { defaultSettings, withSetting } from '../../src/logic/save/settings.js';
import { createSaveStore } from '../../src/save/save-store.js';
import { openStorage } from '../../src/save/storage.js';
import { Rng, boot, createFakeStorage, play, sampleGame } from '../helpers/save.js';

const { keys } = SAVE;
const BAK = (key) => key + SAVE.backupSuffix;
const BAD = (key) => key + SAVE.quarantineSuffix;

function makeStore(backend) {
  return createSaveStore({ storage: openStorage(() => backend), now: () => 1234 });
}

test('저장·불러오기: 런·메타·설정을 따로 쓰고 그대로 읽는다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 120 });
  game.state.meta.souls = 77;
  assert.equal(store.saveRun(game.state).ok, true);
  assert.equal(store.saveMeta(game.state.meta).ok, true);
  const settings = withSetting(defaultSettings(), 'musicVolume', 5);
  assert.equal(store.saveSettings(settings).ok, true);
  assert.deepEqual([...backend.items.keys()].sort(), [keys.meta, keys.run, keys.settings].sort());

  const loaded = makeStore(backend).load();
  assert.equal(loaded.run.result.status, 'exact');
  assert.equal(loaded.run.source, 'primary');
  assert.equal(loaded.run.primaryIssue, null);
  assert.equal(loaded.meta.meta.souls, 77);
  assert.deepEqual(loaded.settings.settings, settings);
  assert.equal(JSON.parse(backend.items.get(keys.run)).savedAt, 1234);
});

test('백업: 새로 쓰기 전에 앞선 저장본을 백업으로 옮기고, 같은 내용은 다시 쓰지 않는다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 5, ticks: 60 });
  assert.deepEqual(store.saveRun(game.state), { ok: true, written: true, backedUp: false, length: backend.items.get(keys.run).length });
  const first = backend.items.get(keys.run);
  const writes = backend.writes;
  assert.equal(store.saveRun(game.state).written, false, '같은 내용');
  assert.equal(backend.writes, writes);
  play(game, Rng.fromSeed('bak'), 30);
  const second = store.saveRun(game.state);
  assert.equal(second.backedUp, true);
  assert.equal(backend.items.get(BAK(keys.run)), first);
  assert.notEqual(backend.items.get(keys.run), first);
});

test('최신본이 망가졌으면 백업으로 이어하고, 망가진 원본은 격리 칸에 남긴다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  play(game, Rng.fromSeed('x'), 30);
  store.saveRun(game.state);
  const good = backend.items.get(BAK(keys.run));
  backend.items.set(keys.run, backend.items.get(keys.run).slice(0, 500)); // 저장 도중 잘림

  const loaded = makeStore(backend).load();
  assert.equal(loaded.run.source, 'backup');
  assert.equal(loaded.run.primaryIssue, 'bad-json');
  assert.equal(loaded.run.result.status, 'exact');
  assert.deepEqual(loaded.run.result, readRun(good));
  assert.equal(backend.items.get(BAD(keys.run)).length, 500);
});

test('최신본과 백업이 모두 망가졌으면 덜 망가진 쪽을 건지고, 둘 다 못 쓰면 새 런', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  play(game, Rng.fromSeed('y'), 30);
  store.saveRun(game.state);
  backend.items.set(keys.run, 'garbage');
  backend.items.set(BAK(keys.run), backend.items.get(BAK(keys.run)).replace('"checksum":"', '"checksum":"0'));
  const salvaged = makeStore(backend).load();
  assert.equal(salvaged.run.source, 'backup');
  assert.equal(salvaged.run.result.status, 'salvage');

  backend.items.set(BAK(keys.run), '{"format":"fable-save"');
  const none = makeStore(backend).load();
  assert.equal(none.run.source, 'none');
  assert.equal(boot(backend).how, 'new');
});

test('망가진 저장본은 백업 칸으로 옮기지 않는다(멀쩡한 백업을 지킨다)', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  play(game, Rng.fromSeed('z'), 30);
  store.saveRun(game.state);
  const goodBackup = backend.items.get(BAK(keys.run));
  // 체크섬은 맞지만 내용이 틀린 최신본(다른 버전의 프로그램이 썼거나 손으로 고친 경우).
  const parsed = JSON.parse(backend.items.get(keys.run));
  parsed.data.entities.byId[parsed.data.playerId].type = 'dragon';
  backend.items.set(keys.run, JSON.stringify(parsed));
  const fresh = makeStore(backend);
  play(game, Rng.fromSeed('z2'), 30);
  const result = fresh.saveRun(game.state);
  assert.equal(result.ok, true);
  assert.equal(result.backedUp, false);
  assert.equal(backend.items.get(BAK(keys.run)), goodBackup);
});

test('검증을 통과하지 못한 상태는 쓰지 않는다 — 앞선 저장본이 그대로 남는다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  const before = backend.items.get(keys.run);
  getPlayer(game.state).hp = Number.NaN;
  const result = store.saveRun(game.state);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-state');
  assert.equal(backend.items.get(keys.run), before);
});

test('용량 초과: 격리본 → 런 백업 순으로 지우고 다시 쓴다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  play(game, Rng.fromSeed('q'), 30);
  store.saveRun(game.state);
  backend.items.set(BAD(keys.run), 'x'.repeat(20000));
  const runLength = backend.items.get(keys.run).length;
  // 격리본만 지우면 들어갈 만큼의 용량.
  backend.quota = backend.used() - 15000;
  play(game, Rng.fromSeed('q2'), 30);
  const first = store.saveRun(game.state);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(backend.items.has(BAD(keys.run)), false);

  // 백업까지 지워야 들어갈 만큼의 용량: 새 최신본이 백업보다 우선이다.
  backend.quota = backend.used() - Math.floor(runLength / 2);
  play(game, Rng.fromSeed('q3'), 30);
  const second = store.saveRun(game.state);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(backend.items.has(BAK(keys.run)), false);
  assert.equal(makeStore(backend).load().run.result.status, 'exact');
});

test('용량 초과: 자리를 비워도 안 되면 실패를 알리고, 이미 있는 저장본은 건드리지 않는다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  const before = backend.items.get(keys.run);
  backend.quota = backend.used() + 10;
  play(game, Rng.fromSeed('full'), 60);
  // 새 세이브가 앞의 것보다 확실히 길어지도록 바닥에 금화를 잔뜩 깐다(올바른 상태다).
  const player = game.state.entities.byId[game.state.playerId];
  for (let i = 0; i < 40; i++) game.state.drops.push({ id: game.state.entities.nextId++, kind: 'gold', x: player.x, y: player.y, amount: 1 });
  const result = store.saveRun(game.state);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quota');
  assert.equal(backend.items.get(keys.run), before);
  assert.equal(makeStore(backend).load().run.result.status, 'exact');
  // 메타는 작아서 들어갈 수도, 안 들어갈 수도 있다. 어느 쪽이든 예외는 없다.
  assert.doesNotThrow(() => store.saveMeta(game.state.meta));
});

test('localStorage 를 쓸 수 없는 환경: 메모리에만 저장하고 게임은 그대로 돌아간다', () => {
  const store = createSaveStore({ storage: openStorage(() => { throw new Error('SecurityError'); }) });
  assert.equal(store.persistent, false);
  assert.equal(store.storageIssue, 'blocked');
  const game = sampleGame({ floor: 9, ticks: 60 });
  assert.equal(store.saveRun(game.state).ok, true);
  assert.equal(store.load().run.result.status, 'exact', '같은 페이지 안에서는 이어할 수 있다');
});

test('런이 끝나면 런 세이브와 백업을 지운다. 지우기가 실패해도 예외는 없다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  play(game, Rng.fromSeed('c'), 30);
  store.saveRun(game.state);
  assert.equal(store.clearRun(), true);
  assert.equal(backend.items.has(keys.run), false);
  assert.equal(backend.items.has(BAK(keys.run)), false);
  backend.failRemove = true;
  assert.equal(store.clearRun(), false);
});

test('끝난 런은 백업에서 되살아나지 않는다', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  play(game, Rng.fromSeed('e'), 30);
  store.saveRun(game.state);
  // 최신본이 "끝난 런"이고 백업은 그 런의 앞선 저장본인 경우.
  const parsed = JSON.parse(backend.items.get(keys.run));
  parsed.data.run.ended = true; // 본문에는 메타가 없어 endRun 으로 정산할 수 없다. 끝난 표시만 한다.
  parsed.data.phase = 'gameOver';
  backend.items.set(keys.run, JSON.stringify(parsed));
  assert.equal(makeStore(backend).load().run.result.status, 'finished');
  assert.equal(boot(backend).how, 'new');
});

test('새 런의 첫 저장 때 앞선 런의 백업이 남아 있으면 지운다', () => {
  const backend = createFakeStorage();
  const old = sampleGame({ floor: 9, ticks: 60 });
  backend.items.set(BAK(keys.run), 'stale backup of an old run');
  makeStore(backend).saveRun(old.state);
  assert.equal(backend.items.has(BAK(keys.run)), false);
});

test('메타가 망가졌으면 백업 메타를 쓰고, 둘 다 못 쓰면 빈 메타(런 세이브는 그대로 이어한다)', () => {
  const backend = createFakeStorage();
  const store = makeStore(backend);
  const game = sampleGame({ floor: 9, ticks: 60 });
  store.saveRun(game.state);
  store.saveMeta({ ...createMeta(), souls: 10 });
  store.saveMeta({ ...createMeta(), souls: 20 });
  backend.items.set(keys.meta, '{"broken');
  const loaded = makeStore(backend).load();
  assert.equal(loaded.meta.source, 'backup');
  assert.equal(loaded.meta.meta.souls, 10);
  assert.equal(loaded.meta.primaryIssue, 'bad-json');

  backend.items.set(BAK(keys.meta), 'also broken');
  const none = makeStore(backend).load();
  assert.equal(none.meta.source, 'default');
  assert.deepEqual(none.meta.meta, createMeta());
  assert.equal(none.run.result.status, 'exact');
});

test('설정이 망가졌으면 기본값으로 시작한다', () => {
  const backend = createFakeStorage({ items: { [keys.settings]: '{"format":"fable-save","kind":"settings","version":1,"data":{"masterVolume":"loud"}}' } });
  const loaded = makeStore(backend).load();
  assert.deepEqual(loaded.settings.settings, defaultSettings());
  assert.ok(loaded.settings.repaired.includes('masterVolume'));
});

test('앱 시작 흐름: 어떤 저장소 상태에서도 게임이 시작된다', () => {
  const game = sampleGame({ floor: 9, ticks: 60 });
  const goodBackend = createFakeStorage();
  makeStore(goodBackend).saveRun(game.state);
  const good = goodBackend.items.get(keys.run);
  const states = {
    '빈 저장소': createFakeStorage(),
    '멀쩡한 세이브': createFakeStorage({ items: { [keys.run]: good } }),
    '잘린 세이브': createFakeStorage({ items: { [keys.run]: good.slice(0, -40) } }),
    '다른 프로그램의 값': createFakeStorage({ items: { [keys.run]: 'hello', [keys.meta]: '[1,2,3]', [keys.settings]: 'true' } }),
    '읽기 차단': createFakeStorage({ failGet: true }),
    '쓰기 불가': createFakeStorage({ failSet: true, items: { [keys.run]: good } }),
  };
  const expect = { '빈 저장소': 'new', '멀쩡한 세이브': 'exact', '잘린 세이브': 'new', '다른 프로그램의 값': 'new', '읽기 차단': 'new', '쓰기 불가': 'exact' };
  for (const [name, backend] of Object.entries(states)) {
    const started = boot(backend);
    assert.equal(started.how, expect[name], name);
    play(started.game, Rng.fromSeed(name), 120);
    assert.doesNotThrow(() => started.store.saveRun(started.game.state), name);
  }
});
