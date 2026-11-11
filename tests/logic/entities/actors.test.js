import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMBAT } from '../../../data/combat.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE, STATE_VERSION } from '../../../src/logic/core/state.js';
import { setInput } from '../../../src/logic/combat/player.js';
import { allActors, findFreeSpot, getPlayer, opponentsOf, spawnEnemy, spawnPlayer } from '../../../src/logic/entities/actors.js';
import { PLAYER_DEF, defOf, enemyDef, statusResistOf } from '../../../src/logic/entities/defs.js';
import { depthScaling } from '../../../src/logic/entities/scaling.js';
import { createGame, enterFloor, setPhase, tick } from '../../../src/logic/game.js';
import { circleFree } from '../../../src/logic/world/collide.js';
import { navOf } from '../../../src/logic/world/nav.js';
import { botStep, createBot } from '../../../scripts/lib/bot.js';
import { DT, createArena, openRoom, sec } from '../../helpers/arena.js';

// ── 생성 ──

test('층에 들어가면 플레이어만 시작점에 생긴다 — 적은 방에 들어설 때 나타난다', () => {
  const game = createGame({ seed: 'spawn' });
  const spawned = [];
  game.bus.on(EVENTS.ENTITY_SPAWNED, (e) => spawned.push(e));
  enterFloor(game, 1);
  const { state } = game;
  const map = state.world;
  const player = getPlayer(state);
  assert.deepEqual([player.x, player.y], [map.start.x + 0.5, map.start.y + 0.5]);
  assert.equal(player.kind, 'player');
  assert.equal(allActors(state).length, 1);
  assert.equal(spawned.length, 1);
  assert.ok(circleFree(navOf(map), player.x, player.y, player.radius));
  assert.equal(state.encounter, null);
});

test('적의 체력·공격은 방의 깊이에 맞춰지고, 정예는 크고 단단하고, 보스는 깊이와 무관하다', () => {
  const a = createArena(openRoom(20, 12), { player: { x: 3.5, y: 5.5 } });
  const def = enemyDef('skeleton');
  a.state.run.depth = 0;
  const shallow = spawnEnemy(a.state, a.bus, 'skeleton', 8.5, 5.5);
  a.state.run.depth = 5;
  const deep = spawnEnemy(a.state, a.bus, 'skeleton', 10.5, 5.5);
  const elite = spawnEnemy(a.state, a.bus, 'skeleton', 12.5, 5.5, { elite: true });
  const boss = spawnEnemy(a.state, a.bus, 'bone_warden', 15.5, 5.5);
  assert.equal(shallow.maxHp, Math.round(def.hp * depthScaling(0).hp));
  assert.equal(deep.maxHp, Math.round(def.hp * depthScaling(5).hp));
  assert.ok(deep.maxHp > shallow.maxHp && deep.power > shallow.power);
  assert.equal(elite.elite, true);
  assert.ok(elite.maxHp > deep.maxHp * 2 && elite.radius > deep.radius && elite.power > deep.power);
  assert.equal(boss.kind, 'boss');
  assert.equal(boss.maxHp, Math.round(enemyDef('bone_warden').hp * depthScaling(0, { boss: true }).hp));
  assert.deepEqual(depthScaling(0, { boss: true }), depthScaling(9, { boss: true }));
  // 깊이가 아무리 깊어도 배율에는 상한이 있다.
  assert.deepEqual(depthScaling(1000), depthScaling(100000));
  for (const e of [shallow, deep, elite, boss]) {
    assert.equal(e.hp, e.maxHp);
    assert.equal(e.ai.mode, 'idle');
  }
});

test('플레이어는 층에 다시 들어가도 유지되고, 적·투사체·장판·전리품은 비워진다', () => {
  const game = createGame({ seed: 'carry' });
  enterFloor(game, 1);
  const { state } = game;
  const player = getPlayer(state);
  player.hp = 37;
  player.kit.weapons = ['hammer', 'laser'];
  spawnEnemy(state, game.bus, 'skeleton', player.x + 2, player.y);
  state.projectiles.push({ id: 999 });
  state.hazards.push({ id: 998 });
  state.drops.push({ id: 997 });
  enterFloor(game, 1);
  assert.equal(getPlayer(state), player);
  assert.equal(player.hp, 37);
  assert.deepEqual(player.kit.weapons, ['hammer', 'laser']);
  assert.equal(allActors(state).length, 1);
  assert.deepEqual([state.projectiles, state.hazards, state.drops], [[], [], []]);
});

test('상태 버전과 새 항목', () => {
  const game = createGame({ seed: 'shape' });
  assert.equal(game.state.version, STATE_VERSION);
  assert.ok(STATE_VERSION >= 5);
  assert.deepEqual(game.state.projectiles, []);
  assert.deepEqual(game.state.hazards, []);
  assert.equal(game.state.encounter, null);
  assert.deepEqual(game.state.input, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false });
});

test('전투 중인 상태도 JSON 으로 왕복하면 그대로다', () => {
  const game = createGame({ seed: 'json-combat' });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  const bot = createBot();
  for (let i = 0; i < sec(40); i++) {
    botStep(game, bot);
    tick(game, DT);
    if (i % 600 === 0) assert.deepEqual(JSON.parse(JSON.stringify(game.state)), game.state);
  }
  assert.ok(game.state.run.kills > 0, '실제로 싸웠다');
});

test('spawnPlayer 는 두 번 부를 수 없고, spawnEnemy 는 모르는 종류를 거부한다', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  assert.throws(() => spawnPlayer(a.state, a.bus, 3.5, 3.5), /이미/);
  assert.throws(() => spawnEnemy(a.state, a.bus, 'dragon', 3.5, 3.5), RangeError);
});

test('정의 찾기: defOf, enemyDef, statusResistOf', () => {
  const a = createArena(openRoom(14, 10), { player: { x: 5.5, y: 5.5 } });
  const golem = a.enemy('stone_golem', { x: 10.5, y: 5.5 });
  assert.equal(defOf(a.player), PLAYER_DEF);
  assert.equal(defOf(golem).name, '돌 골렘');
  assert.equal(enemyDef('nope'), null);
  assert.equal(enemyDef('toString'), null, '객체의 기본 속성 이름은 적이 아니다');
  assert.equal(statusResistOf(defOf(golem), 'poison'), 0);
  assert.equal(statusResistOf(defOf(golem), 'stun'), 0.5);
  assert.equal(statusResistOf(defOf(golem), 'burn'), 1);
  assert.equal(statusResistOf(PLAYER_DEF, 'stun'), 1);
});

test('findFreeSpot: 벽 너머·다른 몸 위·벽에 겹치는 자리는 고르지 않는다', () => {
  const rows = [
    '#########',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#########',
  ];
  const a = createArena(rows, { player: { x: 2.5, y: 2.5 } });
  for (let i = 0; i < 30; i++) {
    const spot = findFreeSpot(a.state, 2.5, 2.5, 0.35, 3);
    assert.ok(spot.x < 4, `벽 너머를 골랐다: ${spot.x},${spot.y}`);
    assert.ok(circleFree(a.nav, spot.x, spot.y, 0.35));
    assert.ok(Math.hypot(spot.x - 2.5, spot.y - 2.5) >= 0.65, '플레이어 위는 안 된다');
  }
  const tiny = createArena(['###', '#.#', '###'], { player: { x: 1.5, y: 1.5 } });
  assert.equal(findFreeSpot(tiny.state, 1.5, 1.5, 0.3, 2), null);
});

// ── 이동 ──

test('몸끼리 겹치지 않는다: 플레이어가 적을 밀고 가면 서로 밀려난다', () => {
  const a = createArena(openRoom(20, 8), { player: { x: 5.5, y: 4.5 } });
  const enemy = a.enemy('zombie', { x: 7.0, y: 4.5 });
  enemy.speed = 0;
  a.step(sec(2), { moveX: 1, moveY: 0 });
  const gap = Math.hypot(enemy.x - a.player.x, enemy.y - a.player.y);
  assert.ok(gap >= a.player.radius + enemy.radius - 1e-6, `간격 ${gap}`);
  assert.ok(enemy.x > 7.0, '적이 밀려났다');
});

test('무거운 몸은 덜 밀린다', () => {
  const push = (type) => {
    const a = createArena(openRoom(30, 8), { player: { x: 5.5, y: 4.5 } });
    const enemy = a.enemy(type, { x: 6.5, y: 4.5 });
    enemy.speed = 0;
    a.step(sec(1), { moveX: 1, moveY: 0 });
    return enemy.x - 6.5;
  };
  const light = push('zombie');
  const heavy = push('stone_golem');
  assert.ok(heavy < light * 0.6, `좀비 ${light.toFixed(2)}칸, 골렘 ${heavy.toFixed(2)}칸`);
});

test('벽과 몸 사이에 끼어도 벽 속으로 밀려 들어가지 않는다', () => {
  const a = createArena(openRoom(12, 6), { player: { x: 3.5, y: 2.5 } });
  const enemy = a.enemy('zombie', { x: 1.6, y: 2.5 });
  enemy.speed = 0;
  a.step(sec(3), { moveX: -1, moveY: 0 });
  assert.ok(circleFree(a.nav, enemy.x, enemy.y, enemy.radius - 1e-6), `적 @${enemy.x},${enemy.y}`);
  assert.ok(circleFree(a.nav, a.player.x, a.player.y, a.player.radius - 1e-6));
});

test('완전히 겹친 두 몸도 떨어진다', () => {
  const a = createArena(openRoom(12, 8), { player: { x: 5.5, y: 4.5 } });
  const enemy = a.enemy('zombie', { x: 5.5, y: 4.5 });
  enemy.speed = 0;
  a.step(2);
  assert.ok(Math.hypot(enemy.x - a.player.x, enemy.y - a.player.y) >= a.player.radius + enemy.radius - 1e-6);
});

// ── 시야 ──
