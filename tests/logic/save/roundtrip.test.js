import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPGRADES } from '../../../data/meta.js';
import { offerBoons } from '../../../src/logic/combat/loot.js';
import { PHASE } from '../../../src/logic/core/state.js';
import { getPlayer } from '../../../src/logic/entities/actors.js';
import { createGame, endRun, enterFloor, resumeGame, setPhase } from '../../../src/logic/game.js';
import { buyUpgrade, createMeta } from '../../../src/logic/items/meta.js';
import { readMeta, readRun, readSettings, serializeMeta, serializeRun, serializeSettings } from '../../../src/logic/save/codec.js';
import { defaultSettings, normalizeSettings, withSetting } from '../../../src/logic/save/settings.js';
import { createBot } from '../../../scripts/lib/bot.js';
import { Rng, cloneGame, play, sampleGame, stageGames } from '../../helpers/save.js';

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

/** 같은 입력 수열로 두 게임을 나란히 돌린다. 봇의 기억도 똑같이 복사해 쓴다. */
function playBoth(a, b, seed, ticks, bots) {
  play(a, Rng.fromSeed(seed), ticks, { bot: bots[0] });
  play(b, Rng.fromSeed(seed), ticks, { bot: bots[1] });
}

const MAGE = { version: 2, souls: 0, upgrades: {}, characters: { mage: true } };
/** 한 판의 여러 순간(시작 방, 전투, 3택1, 상점, 보스전…). */
const MOMENTS = [
  ...stageGames({ seed: 'rt-knight', every: 650, limit: 30 }),
  ...stageGames({ seed: 'rt-mage', meta: MAGE, character: 'mage', every: 900, limit: 10 }),
];

test('표본: 한 판의 여러 순간이 고루 들어 있다(전투 중, 3택1, 축복을 가진 상태, 보스전)', () => {
  assert.ok(MOMENTS.length >= 20, `${MOMENTS.length}개`);
  assert.ok(MOMENTS.some((m) => m.game.state.encounter !== null), '전투 중');
  assert.ok(MOMENTS.some((m) => m.game.state.encounter === null), '전투 밖');
  assert.ok(MOMENTS.some((m) => m.game.state.run.boons.length >= 3), '축복 셋 이상');
  assert.ok(MOMENTS.some((m) => m.game.state.projectiles.length > 0), '날아가는 탄');
  assert.ok(MOMENTS.some((m) => m.game.state.encounter && m.game.state.world.rooms[m.game.state.encounter.room].kind === 'boss'), '보스전');
});

test('왕복: 한 판의 여러 순간에 저장하고 불러오면 상태가 완전히 같다(메타 포함)', () => {
  for (const { game, at, seed } of MOMENTS) {
    const { game: loaded } = roundTrip(cloneGame(game));
    assert.deepStrictEqual(loaded.state, game.state, `${seed} 틱 ${at}`);
  }
});

test('왕복: 불러온 게임과 저장하지 않은 게임에 같은 입력을 주면 이후도 틱마다 같다', () => {
  for (const { game: sample, at, seed } of MOMENTS.filter((_, i) => i % 3 === 0)) {
    const original = cloneGame(sample);
    const { game } = roundTrip(cloneGame(sample));
    const bots = [createBot(), createBot()];
    for (let round = 0; round < 5; round++) {
      playBoth(original, game, `after:${seed}:${at}:${round}`, 120, bots);
      assert.deepStrictEqual(game.state, original.state, `${seed} 틱 ${at}, ${round}번째 120틱 뒤`);
    }
  }
});

test('왕복: 저장한 글을 읽어 다시 저장하면 글자 하나까지 같다', () => {
  const original = sampleGame({ seed: 'rt-text' });
  const { text, game } = roundTrip(original);
  assert.equal(serializeRun(game.state, 777).text, text);
});

test('왕복: 여러 번 저장·불러오기를 거쳐도 한 번도 저장하지 않은 게임과 같다', () => {
  const plain = sampleGame({ seed: 'rt-chain' });
  let saved = sampleGame({ seed: 'rt-chain' });
  const bots = [createBot(), createBot()];
  for (let i = 0; i < 10; i++) {
    playBoth(plain, saved, `chain:${i}`, 53, bots);
    saved = roundTrip(saved).game;
  }
  assert.deepStrictEqual(saved.state, plain.state);
});

test('왕복: 일시정지 중·축복 3택1 이 떠 있는 중·잠긴 방에서 웨이브 예고 중에도 그대로 이어진다', () => {
  const game = sampleGame({ seed: 'rt-pause' });
  const { state } = game;
  assert.ok(state.encounter, '전투 중');
  offerBoons(state, game.bus);
  state.run.choice.rerolls = 2;
  state.encounter.pending.push({ type: 'skeleton', elite: true, x: getPlayer(state).x, y: getPlayer(state).y, at: state.tick + 30 });
  setPhase(game, PHASE.PAUSED);
  const { game: loaded } = roundTrip(game);
  assert.equal(loaded.state.phase, PHASE.PAUSED);
  assert.deepEqual(loaded.state.run.choice, state.run.choice);
  assert.deepEqual(loaded.state.encounter, state.encounter);
  assert.deepStrictEqual(loaded.state, state);
});

test('왕복: 플레이어 위치·체력·무기·에너지·대시 충전·축복·금화·방의 진행이 그대로다', () => {
  const original = sampleGame({ seed: 'rt-player', minTick: 5000 });
  const { game } = roundTrip(original);
  const a = getPlayer(original.state);
  const b = getPlayer(game.state);
  for (const key of ['x', 'y', 'hp', 'maxHp', 'power', 'kbX', 'kbY', 'cooldowns', 'statuses', 'kit']) assert.deepStrictEqual(b[key], a[key], key);
  assert.deepStrictEqual(game.state.run, original.state.run);
  assert.deepStrictEqual(game.state.world.rooms.map((r) => [r.state, r.wave, r.seen]), original.state.world.rooms.map((r) => [r.state, r.wave, r.seen]));
  assert.deepStrictEqual(game.state.world.doors.map((d) => d.open), original.state.world.doors.map((d) => d.open));
  assert.deepStrictEqual(game.state.world.tiles, original.state.world.tiles);
  assert.ok(original.state.run.roomsCleared >= 2 && original.state.run.boons.length >= 1, '표본에 진행이 있다');
});

test('불러올 때 능력치를 다시 합산한다: 런을 저장한 뒤 영구 강화가 늘었으면 반영된다', () => {
  // 자동 저장은 메타를 먼저 쓰고 런을 쓴다. 런 쓰기만 실패하면(용량) 메타가 런보다 새것일 수 있다.
  const game = sampleGame({ seed: 'rt-meta-newer' });
  const read = readRun(serializeRun(game.state).text);
  const meta = { ...structuredClone(game.state.meta), souls: 999 };
  assert.equal(buyUpgrade(meta, 'might').ok, true);
  const before = getPlayer(game.state).power;
  const loaded = resumeGame({ run: read, meta }).game;
  assert.ok(Math.abs(getPlayer(loaded.state).power - (before + UPGRADES.might.effect.power)) < 1e-9);
});

test('저장 거절: 끝난 런·시작 전 상태·망가진 상태는 쓰지 않고 이유를 알린다(예외 없음)', () => {
  const notStarted = createGame({ seed: 'x' });
  assert.deepEqual(serializeRun(notStarted.state), { ok: false, reason: 'not-started' });
  enterFloor(notStarted, 1);
  assert.deepEqual(serializeRun(notStarted.state), { ok: false, reason: 'not-started' }, '타이틀 페이즈');

  const ended = sampleGame({ seed: 'rt-ended' });
  endRun(ended, false);
  assert.deepEqual(serializeRun(ended.state), { ok: false, reason: 'run-ended' });

  const broken = sampleGame({ seed: 'rt-broken' });
  getPlayer(broken.state).x = Number.NaN;
  const result = serializeRun(broken.state);
  assert.equal(result.reason, 'invalid-state');
  assert.ok(result.problems.some((p) => p.startsWith(`entities.byId.${broken.state.playerId}`)), result.problems.join('\n'));

  for (const junk of [null, undefined, 5, 'x', [], {}, { run: null }]) assert.equal(serializeRun(junk).ok, false);
});

test('메타: 런과 따로 저장되고, 왕복하면 그대로다', () => {
  const game = sampleGame({ seed: 'rt-meta' });
  const run = serializeRun(game.state);
  assert.equal(JSON.parse(run.text).data.meta, undefined, '런 세이브에 메타가 들어가지 않는다');

  const meta = { ...createMeta(), souls: 500, runs: 3, victories: 1, bestRooms: 9, totalKills: 420 };
  assert.equal(buyUpgrade(meta, 'purse').ok, true);
  meta.characters.mage = true;
  const read = readMeta(serializeMeta(meta));
  assert.equal(read.ok, true);
  assert.equal(read.repaired, false);
  assert.deepStrictEqual(read.meta, meta);
});

test('메타: 틀린 항목은 0 으로, 모르는 강화·캐릭터는 버리고 나머지는 살린다', () => {
  const text = serializeMeta({ ...createMeta(), souls: 50, runs: 2, bestRooms: 4, totalKills: 9 })
    .replace('"souls":50', '"souls":-3')
    .replace('"upgrades":{}', '"upgrades":{"purse":1,"constructor":1,"god_mode":2,"vigor":"yes","might":99}');
  const read = readMeta(text);
  assert.equal(read.ok, true);
  assert.equal(read.checksumOk, false);
  assert.deepEqual(read.meta.upgrades, { purse: 1, might: UPGRADES.might.cost.length });
  assert.equal(read.meta.souls, 0);
  assert.equal(read.meta.runs, 2);
  assert.equal(read.meta.bestRooms, 4);
  assert.deepEqual(read.meta.characters, { knight: true });
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

test('왕복: 장판이 맵 둘레 밖에 깔린 순간에도 저장된다(검증기가 거절하지 않는다)', () => {
  const game = sampleGame({ seed: 'rt-hazard' });
  const { state } = game;
  const owner = Object.values(state.entities.byId).find((a) => a.kind !== 'player');
  for (const [x, y] of [[state.world.width + 1.5, 3], [-2.4, state.world.height - 2], [5, state.world.height + 0.1]]) {
    state.hazards.push({
      id: state.entities.nextId++, kind: 'blast', ownerId: owner.id, faction: 'enemy', x, y, radius: 1.3, damage: 12, power: owner.power,
      status: { id: 'burn' }, nextAt: state.tick + 30, interval: 0, endAt: state.tick + 30, slow: 1, proc: true,
    });
  }
  const { game: loaded } = roundTrip(game);
  assert.deepStrictEqual(loaded.state, state);
  // 맵에서 터무니없이 먼 장판은 손상으로 본다.
  state.hazards.push({ ...state.hazards[0], id: state.entities.nextId++, x: state.world.width + 40 });
  assert.equal(serializeRun(state).reason, 'invalid-state');
});
