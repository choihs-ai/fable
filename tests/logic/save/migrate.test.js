import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEGACY_UNLOCK_COSTS, META_VERSION } from '../../../data/meta.js';
import { SETTINGS_VERSION } from '../../../data/settings.js';
import { STATE_VERSION } from '../../../src/logic/core/state.js';
import { buyUpgrade } from '../../../src/logic/items/meta.js';
import { resumeGame } from '../../../src/logic/game.js';
import { readMeta, readRun, serializeMeta } from '../../../src/logic/save/codec.js';
import { encodeEnvelope } from '../../../src/logic/save/envelope.js';
import { CURRENT_VERSION, MIGRATIONS, MIN_VERSION, migrate } from '../../../src/logic/save/migrate.js';
import { findBadNumber } from '../../../scripts/lib/save-sim.js';
import { Rng, oldMetaSave, oldSave, play, sampleSave } from '../../helpers/save.js';

test('마이그레이션 표: 읽을 수 있는 가장 낮은 버전부터 현재 버전 직전까지 단계가 하나도 빠지지 않았다', () => {
  assert.deepEqual(CURRENT_VERSION, { run: STATE_VERSION, meta: META_VERSION, settings: SETTINGS_VERSION });
  for (const kind of Object.keys(CURRENT_VERSION)) {
    assert.ok(MIN_VERSION[kind] >= 1 && MIN_VERSION[kind] <= CURRENT_VERSION[kind], kind);
    for (let v = MIN_VERSION[kind]; v < CURRENT_VERSION[kind]; v++) {
      assert.equal(typeof MIGRATIONS[kind][v], 'function', `${kind} v${v} → v${v + 1} 단계가 없다`);
    }
    // 현재 버전 이상이거나 가장 낮은 버전보다 낮은 단계가 있으면, 쓰이지 않는 단계다.
    for (const key of Object.keys(MIGRATIONS[kind])) {
      assert.ok(Number(key) < CURRENT_VERSION[kind] && Number(key) >= MIN_VERSION[kind], `${kind} 에 쓰이지 않는 단계 v${key}`);
    }
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
  // 읽을 수 있는 가장 낮은 버전보다 낮으면 올리지 않는다.
  assert.equal(migrate('run', {}, 2, { table: { 2: (d) => d, 3: (d) => d }, target: 4, min: 3 }).reason, 'retired-version');
  assert.deepEqual(migrate('run', { version: 3 }, 3, { table: { 3: (d) => d }, target: 4, min: 3 }).steps, [3]);
  // 부르는 쪽의 실수는 예외.
  assert.throws(() => migrate('score', {}, 1), RangeError);
  assert.throws(() => migrate('run', {}, 0), RangeError);
  assert.throws(() => migrate('run', {}, '1'), RangeError);
});

test('방 단위 구조 이전의 런(버전 1~4)은 이어할 수 없다고 알리고, 예외를 던지지 않는다', () => {
  for (const version of [1, 2, 3, 4]) {
    const { text } = oldSave(version);
    const read = readRun(text);
    assert.equal(read.status, 'none', `v${version}`);
    assert.equal(read.reason, 'retired-version', `v${version}`);
    assert.equal(resumeGame({ run: read, meta: null }), null);
    assert.equal(migrate('run', {}, version).reason, 'retired-version');
  }
  // 본문이 무엇이든 마찬가지다.
  for (const junk of [{}, { run: 5 }, { run: null, entities: 'x' }, { seed: 'a', run: { floor: 1 } }]) {
    assert.equal(readRun(encodeEnvelope({ kind: 'run', version: 4, data: structuredClone(junk) })).status, 'none');
  }
});

test('현재 버전의 런은 마이그레이션 없이 그대로 읽힌다', () => {
  const { text, data } = sampleSave({ seed: 'migrate-current' });
  const read = readRun(text);
  assert.equal(read.status, 'exact');
  assert.deepEqual(read.migrated, []);
  assert.equal(read.version, STATE_VERSION);
  assert.equal(read.state.tick, data.tick);
});

test('봉투의 버전이 거짓이면(본문은 옛 버전인데 봉투는 현재 버전) 손상으로 다룬다', () => {
  const { data } = oldSave(3);
  const read = readRun(encodeEnvelope({ kind: 'run', version: STATE_VERSION, data, savedAt: 1 }));
  // 옛 구조의 본문이라 층은 못 쓰지만 시드와 층 번호는 건질 수 있다 — 다만 그 층 번호가 지금의 범위를 벗어나면 버린다.
  assert.equal(read.status, 'none');
  assert.equal(read.reason, 'unrecoverable');
  const { data: again } = oldSave(3);
  again.run.floor = 1;
  const salvaged = readRun(encodeEnvelope({ kind: 'run', version: STATE_VERSION, data: again, savedAt: 1 }));
  assert.equal(salvaged.status, 'salvage');
  assert.equal(salvaged.damaged, true);
  assert.ok(salvaged.problems.length > 0);
  const { game } = resumeGame({ run: salvaged, meta: null });
  play(game, Rng.fromSeed('lie'), 300);
  assert.equal(findBadNumber(game.state), null);
});

test('메타 v1 세이브(방 단위 구조 이전): 영혼석과 기록은 남고, 사 두었던 옛 해금은 영혼석으로 돌려받는다', () => {
  const { text, data } = oldMetaSave();
  const read = readMeta(text);
  assert.equal(read.ok, true);
  assert.equal(read.version, 1);
  const refund = LEGACY_UNLOCK_COSTS.vigor_1 + LEGACY_UNLOCK_COSTS.purse_1 + LEGACY_UNLOCK_COSTS.relic_pack;
  assert.deepEqual(read.meta, {
    version: META_VERSION, souls: data.souls + refund, upgrades: {}, characters: { knight: true },
    runs: data.runs, victories: data.victories, bestRooms: 0, totalKills: data.totalKills,
  });
  // 돌려받은 영혼석으로 새 강화를 살 수 있다.
  assert.equal(buyUpgrade(read.meta, 'vigor').ok, true);
  // 다시 쓰면 현재 버전으로 저장되고, 다시 읽어도 같다.
  const again = readMeta(serializeMeta(read.meta, 5));
  assert.equal(again.version, META_VERSION);
  assert.deepEqual(again.meta, read.meta);
});

test('메타 v1 마이그레이션은 손상된 본문을 받아도 예외를 던지지 않는다', () => {
  const cases = [
    [{}, 0],
    [{ souls: -5, unlocked: null, runs: 'x' }, 0],
    [{ souls: 10, unlocked: [1, 2] }, 10],
    [{ souls: 10, unlocked: { vigor_1: 'yes', nope: true, constructor: true, might_1: true } }, 10 + LEGACY_UNLOCK_COSTS.might_1],
    [{ souls: 1.5, unlocked: { toString: true } }, 0],
  ];
  for (const [junk, souls] of cases) {
    const read = readMeta(encodeEnvelope({ kind: 'meta', version: 1, data: structuredClone(junk) }));
    assert.equal(read.ok, true, JSON.stringify(junk));
    assert.equal(read.meta.souls, souls, JSON.stringify(junk));
    assert.deepEqual(read.meta.upgrades, {});
  }
});

test('설정 v1 세이브(4단계가 쓴 것): 감도가 기본값으로 채워지고 나머지는 그대로다', async () => {
  const { readSettings } = await import('../../../src/logic/save/codec.js');
  // 4단계(설정 버전 1)의 serializeSettings 가 실제로 쓰던 본문 그대로다.
  const v1 = { masterVolume: 35, musicVolume: 60, sfxVolume: 80, vibration: false, quality: 'high', leftHanded: true };
  const read = readSettings(encodeEnvelope({ kind: 'settings', version: 1, data: v1, savedAt: 1 }));
  assert.equal(read.reason, null);
  assert.deepEqual(read.repaired, []);
  assert.deepEqual(read.settings, { ...v1, sensitivity: 100 });
});
