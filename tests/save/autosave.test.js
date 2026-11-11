import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAVE } from '../../data/save.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { PHASE } from '../../src/logic/core/state.js';
import { getPlayer } from '../../src/logic/entities/actors.js';
import { endRun, enterFloor, rescueGame, setPhase, tick } from '../../src/logic/game.js';
import { readRun } from '../../src/logic/save/codec.js';
import { bindLifecycle, createAutosave } from '../../src/save/autosave.js';
import { createSaveStore } from '../../src/save/save-store.js';
import { openStorage } from '../../src/save/storage.js';
import { DT } from '../../scripts/lib/save-sim.js';
import { Rng, createFakeStorage, play, sampleGame } from '../helpers/save.js';

const { keys } = SAVE;

/** 이벤트 대상 흉내(document·window). */
function fakeTarget(extra = {}) {
  const listeners = {};
  return {
    ...extra,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
    fire(type) { for (const fn of listeners[type] ?? []) fn(); },
    count: (type) => (listeners[type] ?? []).length,
  };
}

function setup({ floor = 9 } = {}) {
  const backend = createFakeStorage();
  const store = createSaveStore({ storage: openStorage(() => backend), now: () => 1 });
  let game = sampleGame({ floor, ticks: 60 });
  const results = [];
  const autosave = createAutosave({ getGame: () => game, store, onResult: (r) => results.push(r) });
  const detach = autosave.attach(game.bus);
  return { backend, store, autosave, results, detach, get game() { return game; }, set game(g) { game = g; } };
}

const savedRun = (backend) => readRun(backend.items.get(keys.run));

test('층 이동: 저장을 예약하고, 틱이 끝난 뒤 flush 에서 새 층으로 저장한다', () => {
  const ctx = setup({ floor: 9 });
  assert.equal(ctx.autosave.flush(), null, '예약된 것이 없으면 아무것도 하지 않는다');
  enterFloor(ctx.game, 10);
  assert.equal(ctx.autosave.pending, 'floor');
  assert.equal(ctx.backend.items.has(keys.run), false, '이벤트가 난 자리에서는 쓰지 않는다');
  const result = ctx.autosave.flush();
  assert.equal(result.trigger, 'floor');
  assert.equal(result.run.ok, true);
  assert.equal(result.meta.ok, true);
  assert.equal(savedRun(ctx.backend).state.run.floor, 10);
  assert.equal(ctx.autosave.pending, null);
});

test('일시정지: PAUSED 로 바뀌면 저장한다. 다른 페이즈 변화는 저장하지 않는다', () => {
  const ctx = setup();
  setPhase(ctx.game, PHASE.PAUSED);
  assert.equal(ctx.autosave.flush().trigger, 'pause');
  assert.equal(savedRun(ctx.backend).state.phase, PHASE.PAUSED);
  setPhase(ctx.game, PHASE.PLAYING);
  assert.equal(ctx.autosave.flush(), null);
});

test('백그라운드 전환: 화면이 가려지면(visibilitychange → hidden) 그 자리에서 곧바로 저장한다', () => {
  const ctx = setup();
  const doc = fakeTarget({ visibilityState: 'visible' });
  const win = fakeTarget();
  const unbind = bindLifecycle({ doc, win, autosave: ctx.autosave });
  doc.fire('visibilitychange');
  assert.equal(ctx.results.length, 0, '보이게 될 때는 저장하지 않는다');
  play(ctx.game, Rng.fromSeed('bg'), 45);
  doc.visibilityState = 'hidden';
  doc.fire('visibilitychange');
  assert.equal(ctx.results.length, 1);
  assert.equal(ctx.results[0].trigger, 'background');
  assert.deepEqual(savedRun(ctx.backend).state.tick, ctx.game.state.tick);

  win.fire('pagehide');
  assert.equal(ctx.results.at(-1).trigger, 'pagehide');

  unbind();
  assert.equal(doc.count('visibilitychange'), 0);
  assert.equal(win.count('pagehide'), 0);
});

test('런 종료: 메타는 저장하고 런 세이브는 지운다(죽은 런을 이어하지 않도록)', () => {
  const ctx = setup();
  ctx.autosave.saveNow('manual');
  assert.equal(ctx.backend.items.has(keys.run), true);
  play(ctx.game, Rng.fromSeed('end'), 30);
  ctx.autosave.saveNow('manual');
  assert.equal(ctx.backend.items.has(keys.run + SAVE.backupSuffix), true);

  const soulsBefore = ctx.game.state.meta.souls;
  endRun(ctx.game, false);
  const result = ctx.autosave.flush();
  assert.equal(result.trigger, 'run-ended');
  assert.equal(result.run.reason, 'run-ended');
  assert.equal(ctx.backend.items.has(keys.run), false);
  assert.equal(ctx.backend.items.has(keys.run + SAVE.backupSuffix), false);
  assert.ok(JSON.parse(ctx.backend.items.get(keys.meta)).data.souls > soulsBefore, '정산된 영혼석이 저장된다');
});

test('플레이어가 실제로 죽어 런이 끝나는 흐름에서도 런 세이브가 지워진다', () => {
  const ctx = setup({ floor: 25 });
  ctx.autosave.saveNow('manual');
  const player = getPlayer(ctx.game.state);
  player.hp = 1;
  player.maxHp = 1;
  for (let i = 0; i < 6000 && !ctx.game.state.run.ended; i++) {
    ctx.game.state.input.moveX = 0;
    tick(ctx.game, DT);
    // 적에게 맞을 때까지 기다린다. 오래 걸리면 직접 끝낸다.
    if (i === 5999) endRun(ctx.game, false);
  }
  ctx.autosave.flush();
  assert.equal(ctx.backend.items.has(keys.run), false);
});

test('저장이 실패해도 게임은 계속되고, 알림을 받는 쪽의 오류도 저장 흐름을 끊지 않는다', () => {
  const backend = createFakeStorage();
  const store = createSaveStore({ storage: openStorage(() => backend) });
  const game = sampleGame({ floor: 9, ticks: 60 });
  const autosave = createAutosave({ getGame: () => game, store, onResult: () => { throw new Error('ui 오류'); } });
  backend.quota = 10;
  let result;
  assert.doesNotThrow(() => { result = autosave.saveNow('manual'); });
  assert.equal(result.run.ok, false);
  assert.equal(result.run.reason, 'quota');

  // 저장소 자체가 예외를 던져도(예상 밖의 오류) 결과로 바뀐다.
  const broken = createAutosave({ getGame: () => { throw new Error('게임 없음'); }, store });
  assert.equal(broken.saveNow('manual').run.reason, 'exception');
});

test('예약은 처음 것이 남되, 런 종료는 언제나 우선한다', () => {
  const ctx = setup();
  ctx.autosave.request('first');
  setPhase(ctx.game, PHASE.PAUSED);
  assert.equal(ctx.autosave.pending, 'first');
  ctx.game.bus.emit(EVENTS.RUN_ENDED, {});
  assert.equal(ctx.autosave.pending, 'run-ended');
  ctx.detach();
  ctx.autosave.flush();
  enterFloor(ctx.game, 10);
  assert.equal(ctx.autosave.pending, null, '연결을 끊은 뒤에는 예약하지 않는다');
});

test('틱 예외 복구(rescueGame): 핵심만 건져 같은 층을 다시 차리고, 같은 이벤트버스를 쓴다', () => {
  const ctx = setup({ floor: 15 });
  const before = ctx.game.state;
  const restored = [];
  ctx.game.bus.on(EVENTS.GAME_RESTORED, (e) => restored.push(e));
  // 로직이 망가진 상황을 흉내: 행동체 하나가 NaN 위치를 갖게 됐다.
  getPlayer(before).x = Number.NaN;
  const rescued = rescueGame(ctx.game);
  assert.ok(rescued);
  assert.equal(rescued.bus, ctx.game.bus);
  assert.deepEqual(restored, [{ mode: 'rebuilt', floor: 15 }]);
  assert.equal(rescued.state.seed, before.seed);
  assert.equal(rescued.state.run.floor, 15);
  assert.deepEqual(rescued.state.inventory, before.inventory);
  assert.deepEqual(rescued.state.run.upgrades, before.run.upgrades);
  assert.equal(rescued.state.phase, PHASE.PAUSED);
  ctx.game = rescued;
  setPhase(rescued, PHASE.PLAYING);
  play(rescued, Rng.fromSeed('rescued'), 300);
  // 다시 차린 층은 FLOOR_ENTERED 로 저장이 예약된다.
  assert.equal(ctx.autosave.flush().run.ok, true);

  const ended = sampleGame({ floor: 5, ticks: 30 });
  endRun(ended, false);
  assert.equal(rescueGame(ended), null, '끝난 런은 되살리지 않는다');
});
