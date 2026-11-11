import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHASE } from '../../../src/logic/core/state.js';
import { getPlayer } from '../../../src/logic/entities/actors.js';
import { createGame, endRun, enterFloor, resumeGame, setPhase } from '../../../src/logic/game.js';
import { addConsumable } from '../../../src/logic/items/inventory.js';
import { purchaseUnlock } from '../../../src/logic/items/meta.js';
import { useConsumable } from '../../../src/logic/commands.js';
import { readMeta, readRun, readSettings, serializeMeta, serializeRun, serializeSettings } from '../../../src/logic/save/codec.js';
import { defaultSettings, normalizeSettings, withSetting } from '../../../src/logic/save/settings.js';
import { Rng, play, sampleGame } from '../../helpers/save.js';

/** 저장 → (메타는 따로) → 읽기 → 이어하기. */
function roundTrip(game) {
  const run = serializeRun(game.state, 777);
  assert.ok(run.ok, JSON.stringify(run).slice(0, 300));
  const meta = readMeta(serializeMeta(game.state.meta, 777));
  assert.equal(meta.ok, true);
  const read = readRun(run.text);
  assert.equal(read.status, 'exact', JSON.stringify(read).slice(0, 300));
  const resumed = resumeGame({ run: read, meta: meta.meta });
  assert.equal(resumed.mode, 'exact');
  return { text: run.text, game: resumed.game };
}

/** 같은 입력 수열로 두 게임을 나란히 돌린다. */
function playBoth(a, b, seed, ticks) {
  play(a, Rng.fromSeed(seed), ticks);
  play(b, Rng.fromSeed(seed), ticks);
}

const FLOORS = [1, 5, 9, 15, 22, 25, 30];

test('왕복: 층마다 전투 중에 저장하고 불러오면 상태가 완전히 같다(메타 포함)', () => {
  for (const floor of FLOORS) {
    const original = sampleGame({ floor, ticks: 300 });
    const { game } = roundTrip(original);
    assert.deepStrictEqual(game.state, original.state, `${floor}층`);
  }
});

test('왕복: 불러온 게임과 저장하지 않은 게임에 같은 입력을 주면 이후도 틱마다 같다', () => {
  for (const floor of [5, 9, 30]) {
    const original = sampleGame({ floor, ticks: 300 });
    const { game } = roundTrip(original);
    for (let round = 0; round < 6; round++) {
      playBoth(original, game, `after:${floor}:${round}`, 100);
      assert.deepStrictEqual(game.state, original.state, `${floor}층 ${round}번째 100틱 뒤`);
    }
  }
});

test('왕복: 저장한 글을 읽어 다시 저장하면 글자 하나까지 같다', () => {
  const original = sampleGame({ floor: 15, ticks: 300 });
  const { text, game } = roundTrip(original);
  assert.equal(serializeRun(game.state, 777).text, text);
});

test('왕복: 여러 번 저장·불러오기를 거쳐도 한 번도 저장하지 않은 게임과 같다', () => {
  const plain = sampleGame({ floor: 22, ticks: 120 });
  let saved = sampleGame({ floor: 22, ticks: 120 });
  for (let i = 0; i < 8; i++) {
    playBoth(plain, saved, `chain:${i}`, 37);
    saved = roundTrip(saved).game;
  }
  assert.deepStrictEqual(saved.state, plain.state);
});

test('왕복: 일시정지 중·강화 후보가 제시된 중·물약 효과가 남은 중에도 그대로 이어진다', () => {
  const game = sampleGame({ floor: 9, ticks: 300 });
  const { state } = game;
  state.run.pendingChoices = 2;
  state.run.choice = { options: [{ kind: 'upgrade', id: 'sharpness' }, { kind: 'filler', id: 'feast' }] };
  // 물약은 실제 명령으로 쓴다(능력치 다시 합산까지 거친다).
  addConsumable(state.inventory, 'power_elixir', 1);
  assert.equal(useConsumable(game, 'power_elixir').ok, true);
  assert.equal(state.run.buffs.length, 1);
  setPhase(game, PHASE.PAUSED);
  const { game: loaded } = roundTrip(game);
  assert.equal(loaded.state.phase, PHASE.PAUSED);
  assert.deepEqual(loaded.state.run.choice, state.run.choice);
  assert.equal(loaded.state.run.pendingChoices, 2);
  assert.deepEqual(loaded.state.run.buffs, state.run.buffs);
  assert.deepStrictEqual(loaded.state, state);
});

test('왕복: 플레이어 위치·체력·장비·유물·금화·강화·경험치·처치 수가 그대로다', () => {
  const original = sampleGame({ floor: 25, ticks: 300 });
  const { game } = roundTrip(original);
  const a = getPlayer(original.state);
  const b = getPlayer(game.state);
  for (const key of ['x', 'y', 'hp', 'maxHp', 'power', 'armor', 'cooldowns', 'statuses']) assert.deepStrictEqual(b[key], a[key], key);
  assert.deepStrictEqual(game.state.inventory, original.state.inventory);
  assert.deepStrictEqual(game.state.run, original.state.run);
  assert.ok(original.state.inventory.relics.length > 0 && original.state.run.level > 5, '표본에 성장 요소가 있다');
});

test('저장 거절: 끝난 런·시작 전 상태·망가진 상태는 쓰지 않고 이유를 알린다(예외 없음)', () => {
  const notStarted = createGame({ seed: 'x' });
  assert.deepEqual(serializeRun(notStarted.state), { ok: false, reason: 'not-started' });
  enterFloor(notStarted, 1);
  assert.deepEqual(serializeRun(notStarted.state), { ok: false, reason: 'not-started' }, '타이틀 페이즈');

  const ended = sampleGame({ floor: 5, ticks: 60 });
  endRun(ended, false);
  assert.deepEqual(serializeRun(ended.state), { ok: false, reason: 'run-ended' });

  const broken = sampleGame({ floor: 5, ticks: 60 });
  getPlayer(broken.state).x = Number.NaN;
  const result = serializeRun(broken.state);
  assert.equal(result.reason, 'invalid-state');
  assert.ok(result.problems.some((p) => p.startsWith(`entities.byId.${broken.state.playerId}`)), result.problems.join('\n'));

  for (const junk of [null, undefined, 5, 'x', [], {}, { run: null }]) assert.equal(serializeRun(junk).ok, false);
});

test('메타: 런과 따로 저장되고, 왕복하면 그대로다', () => {
  const game = sampleGame({ floor: 9, ticks: 30 });
  const run = serializeRun(game.state);
  assert.equal(JSON.parse(run.text).data.meta, undefined, '런 세이브에 메타가 들어가지 않는다');

  const meta = { version: 1, souls: 500, unlocked: {}, runs: 3, victories: 1, bestFloor: 18, totalKills: 420 };
  assert.equal(purchaseUnlock(meta, 'purse_1').ok, true);
  const read = readMeta(serializeMeta(meta));
  assert.equal(read.ok, true);
  assert.equal(read.repaired, false);
  assert.deepStrictEqual(read.meta, meta);
});

test('메타: 틀린 항목은 0 으로, 모르는 해금은 버리고 나머지는 살린다', () => {
  const text = serializeMeta({ souls: 50, unlocked: {}, runs: 2, victories: 0, bestFloor: 4, totalKills: 9 })
    .replace('"souls":50', '"souls":-3')
    .replace('"unlocked":{}', '"unlocked":{"purse_1":true,"constructor":true,"god_mode":true,"relic_pack":"yes"}');
  const read = readMeta(text);
  assert.equal(read.ok, true);
  assert.equal(read.checksumOk, false);
  assert.deepEqual(read.meta.unlocked, { purse_1: true });
  assert.equal(read.meta.souls, 0);
  assert.equal(read.meta.runs, 2);
  assert.equal(read.meta.bestFloor, 4);
  for (const bad of [null, '', '{', 'null', '[]']) assert.equal(readMeta(bad).ok, false);
});

test('설정: 왕복하면 그대로이고, 틀린 항목만 기본값으로 되돌린다', () => {
  const mine = withSetting(withSetting(defaultSettings(), 'masterVolume', 35), 'quality', 'high');
  assert.deepEqual(readSettings(serializeSettings(mine)), { settings: mine, repaired: [], reason: null });

  const broken = serializeSettings(mine).replace('"masterVolume":35', '"masterVolume":350').replace('"quality":"high"', '"quality":"ultra"');
  const read = readSettings(broken);
  assert.equal(read.settings.masterVolume, defaultSettings().masterVolume);
  assert.equal(read.settings.quality, defaultSettings().quality);
  assert.equal(read.settings.vibration, mine.vibration);
  assert.deepEqual(read.repaired.sort(), ['masterVolume', 'quality']);

  for (const bad of [null, 'garbage', '{"format":"fable-save"}']) assert.deepEqual(readSettings(bad).settings, defaultSettings());
  assert.deepEqual(normalizeSettings({ musicVolume: 10, extra: 1 }).repaired.includes('extra'), true);
  assert.throws(() => withSetting(defaultSettings(), 'nope', 1), RangeError);
  assert.throws(() => withSetting(defaultSettings(), 'masterVolume', 101), RangeError);
  assert.throws(() => withSetting(defaultSettings(), 'vibration', 'yes'), RangeError);
});
