import assert from 'node:assert/strict';
import { test } from 'node:test';
import { META_VERSION } from '../../../data/meta.js';
import { SETTINGS_VERSION } from '../../../data/settings.js';
import { PHASE, STATE_VERSION } from '../../../src/logic/core/state.js';
import { getPlayer } from '../../../src/logic/entities/actors.js';
import { resumeGame } from '../../../src/logic/game.js';
import { readRun, serializeRun } from '../../../src/logic/save/codec.js';
import { encodeEnvelope } from '../../../src/logic/save/envelope.js';
import { CURRENT_VERSION, MIGRATIONS, migrate } from '../../../src/logic/save/migrate.js';
import { validateRunState } from '../../../src/logic/save/validate.js';
import { findBadNumber } from '../../../scripts/lib/save-sim.js';
import { Rng, oldSave, play } from '../../helpers/save.js';

test('마이그레이션 표: 1 부터 현재 버전 직전까지 단계가 하나도 빠지지 않았다', () => {
  assert.deepEqual(CURRENT_VERSION, { run: STATE_VERSION, meta: META_VERSION, settings: SETTINGS_VERSION });
  for (const kind of Object.keys(CURRENT_VERSION)) {
    for (let v = 1; v < CURRENT_VERSION[kind]; v++) {
      assert.equal(typeof MIGRATIONS[kind][v], 'function', `${kind} v${v} → v${v + 1} 단계가 없다`);
    }
    // 현재 버전 이상의 단계가 있으면 버전을 올리지 않고 단계만 추가한 것이다.
    for (const key of Object.keys(MIGRATIONS[kind])) assert.ok(Number(key) < CURRENT_VERSION[kind], `${kind} 에 쓰이지 않는 단계 v${key}`);
  }
});

test('마이그레이션: 한 단계씩 순서대로 돌고, 단계마다 version 을 올린다', () => {
  const calls = [];
  const table = {
    1: (d) => { calls.push(['1→2', d.version]); return { ...d, a: 1 }; },
    2: (d) => { calls.push(['2→3', d.version]); return { ...d, b: d.a + 1 }; },
    3: (d) => { calls.push(['3→4', d.version]); return { ...d, c: d.b + 1 }; },
  };
  const result = migrate('run', { version: 1 }, 1, { table, target: 4 });
  assert.deepEqual(result, { ok: true, data: { version: 4, a: 1, b: 2, c: 3 }, steps: [1, 2, 3] });
  assert.deepEqual(calls, [['1→2', 1], ['2→3', 2], ['3→4', 3]]);
  // 중간 버전에서 시작하면 그 뒤 단계만 돈다.
  calls.length = 0;
  assert.deepEqual(migrate('run', { version: 3, b: 7 }, 3, { table, target: 4 }).data, { version: 4, b: 7, c: 8 });
  assert.deepEqual(calls, [['3→4', 3]]);
  // 이미 현재 버전이면 아무것도 하지 않는다.
  assert.deepEqual(migrate('run', { version: 4 }, 4, { table, target: 4 }), { ok: true, data: { version: 4 }, steps: [] });
});

test('마이그레이션: 새 버전·빠진 단계·예외·잘못된 결과는 실패로 알리고 예외를 던지지 않는다', () => {
  const table = { 1: (d) => d, 3: (d) => d };
  assert.deepEqual(migrate('run', {}, 9, { table, target: 4 }), { ok: false, reason: 'newer-version' });
  assert.deepEqual(migrate('run', {}, 1, { table, target: 4 }), { ok: false, reason: 'no-migration', detail: 'v2 → v3' });
  const boom = { 1: () => { throw new Error('펑'); } };
  const failed = migrate('run', {}, 1, { table: boom, target: 2 });
  assert.equal(failed.reason, 'migration-failed');
  assert.match(failed.detail, /v1 → v2: 펑/);
  assert.equal(migrate('run', {}, 1, { table: { 1: () => null }, target: 2 }).reason, 'migration-failed');
  assert.equal(migrate('run', {}, 1, { table: { 1: () => [1] }, target: 2 }).reason, 'migration-failed');
  // "constructor" 같은 물려받은 이름을 단계로 착각하지 않는다.
  assert.equal(migrate('run', {}, 1, { table: Object.create({ 1: (d) => d }), target: 2 }).reason, 'no-migration');
  // 부르는 쪽의 실수는 예외.
  assert.throws(() => migrate('score', {}, 1), RangeError);
  assert.throws(() => migrate('run', {}, 0), RangeError);
  assert.throws(() => migrate('run', {}, '1'), RangeError);
});

test('실제 런 마이그레이션은 손상된 본문을 받아도 예외를 던지지 않는다(판단은 검증기가 한다)', () => {
  for (const junk of [{}, { run: 5 }, { run: null, entities: 'x' }, { entities: { byId: { 1: 7, 2: null } }, projectiles: [null, 3] }]) {
    const result = migrate('run', structuredClone(junk), 1);
    assert.equal(result.ok, true);
    assert.deepEqual(readRun(encodeEnvelope({ kind: 'run', version: 1, data: structuredClone(junk) })).status, 'none');
  }
});

/** 옛 세이브를 읽어 이어하고, 잠시 돌린 뒤에도 상태가 온전한지 본다. */
function loadAndPlay(version) {
  const { data, text } = oldSave(version);
  const read = readRun(text);
  const resumed = resumeGame({ run: read, meta: null });
  assert.ok(resumed, `v${version} 를 이어하지 못함: ${JSON.stringify(read).slice(0, 200)}`);
  const { game } = resumed;
  play(game, Rng.fromSeed(`old-v${version}`), 600);
  assert.deepEqual(validateRunState(game.state), []);
  assert.equal(findBadNumber(game.state), null);
  return { data, read, resumed, game };
}

test('v1 세이브(0단계, 실제 코드가 만든 것): 시드·층·틱을 지키고 그 층을 새로 만들어 이어한다', () => {
  const { data, read, resumed, game } = loadAndPlay(1);
  assert.equal(read.status, 'salvage');
  assert.equal(read.damaged, false, '옛 버전 세이브는 손상으로 보지 않는다');
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.migrated, [1, 2, 3]);
  assert.equal(resumed.mode, 'rebuilt');
  assert.equal(game.state.seed, data.seed);
  assert.equal(game.state.run.floor, 7);
  assert.equal(game.state.world.floor, 7);
  assert.ok(game.state.tick >= data.tick, '틱은 이어서 센다');
  assert.equal(game.state.version, STATE_VERSION);
});

test('v2 세이브(1단계: 맵만 있음): 같은 층을 다시 만들고, 타일은 v2 의 맵과 같다', () => {
  const { data, read, game } = loadAndPlay(2);
  assert.equal(read.status, 'salvage');
  assert.equal(read.damaged, false);
  assert.deepEqual(read.migrated, [2, 3]);
  assert.equal(game.state.run.floor, data.run.floor);
  // 맵 생성 알고리즘은 1단계 이후 그대로라서 타일·시작점·계단은 같다(적 배치 수만 3단계에서 바뀌었다).
  assert.deepEqual(game.state.world.tiles, data.world.tiles);
  assert.deepEqual(game.state.world.start, data.world.start);
  assert.deepEqual(game.state.world.stairs, data.world.stairs);
});

test('v3 세이브(2단계: 전투 중): 저장한 순간 그대로 이어한다 — 위치·체력·상태이상·기술 준비가 남는다', () => {
  const { data } = oldSave(3);
  const read = readRun(oldSave(3).text);
  assert.equal(read.status, 'exact');
  assert.deepEqual(read.migrated, [3]);
  const before = read.state;
  // 옛 필드는 그대로 남아 있다.
  for (const id of Object.keys(data.entities.byId)) {
    const old = data.entities.byId[id];
    const now = before.entities.byId[id];
    for (const key of ['x', 'y', 'hp', 'maxHp', 'armor', 'speed', 'statuses', 'cooldowns', 'action', 'ai']) {
      assert.deepEqual(now[key], old[key], `행동체 ${id} 의 ${key}`);
    }
    // 새 필드는 기본값(적은 층별 배율 없이 만들어졌으므로 배율 1).
    if (old.kind !== 'player') assert.equal(now.power, 1);
  }
  assert.ok(Object.values(data.entities.byId).some((a) => Object.keys(a.statuses).length > 0), '표본에 상태이상이 있다');
  assert.ok(Object.values(data.entities.byId).some((a) => a.action !== null), '표본에 진행 중인 기술이 있다');
  assert.deepEqual(before.rng, data.rng);
  assert.equal(before.tick, data.tick);
  assert.equal(before.run.level, 1);
  assert.deepEqual(before.inventory.bag, []);

  const { game } = loadAndPlay(3);
  assert.equal(getPlayer(game.state).id, data.playerId);
});

test('옛 세이브를 이어한 게임은 현재 버전으로 다시 저장되고, 그것을 읽으면 그대로다', () => {
  for (const version of [1, 2, 3]) {
    const { game } = loadAndPlay(version);
    if (game.state.phase !== PHASE.PLAYING) continue;
    const saved = serializeRun(game.state, 5);
    assert.ok(saved.ok, `v${version}: ${JSON.stringify(saved)}`);
    assert.equal(JSON.parse(saved.text).version, STATE_VERSION);
    const again = readRun(saved.text);
    assert.equal(again.status, 'exact');
    assert.deepEqual(again.migrated, []);
    const { meta: _meta, ...withoutMeta } = game.state;
    assert.deepEqual(again.state, withoutMeta);
  }
});

test('옛 세이브의 봉투 버전이 거짓이면(본문은 v1 인데 봉투는 v3) 손상으로 다룬다', () => {
  const { data } = oldSave(1);
  const read = readRun(encodeEnvelope({ kind: 'run', version: 3, data, savedAt: 1 }));
  assert.equal(read.status, 'salvage');
  assert.equal(read.damaged, true);
  assert.ok(read.problems.length > 0);
});
