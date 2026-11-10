import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMBAT } from '../../../data/combat.js';
import { PLAYER } from '../../../data/player.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE, STATE_VERSION } from '../../../src/logic/core/state.js';
import { setInput } from '../../../src/logic/combat/player.js';
import { allActors, findFreeSpot, getPlayer, opponentsOf, spawnEnemy, spawnPlayer } from '../../../src/logic/entities/actors.js';
import { defOf, enemyDef, isBossType, statusResistOf } from '../../../src/logic/entities/defs.js';
import { isVisible } from '../../../src/logic/entities/vision.js';
import { createGame, enterFloor, setPhase, tick } from '../../../src/logic/game.js';
import { circleFree } from '../../../src/logic/world/collide.js';
import { TOTAL_FLOORS } from '../../../src/logic/world/floors.js';
import { navOf } from '../../../src/logic/world/nav.js';
import { DT, createArena, openRoom, sec } from '../../helpers/arena.js';

// ── 생성 ──

test('층에 들어가면 플레이어가 시작점에, 맵의 배치대로 적·보스가 생긴다', () => {
  for (const floor of [1, 5, 13, 22, TOTAL_FLOORS]) {
    const game = createGame({ seed: 'spawn' });
    const spawned = [];
    game.bus.on(EVENTS.ENTITY_SPAWNED, (e) => spawned.push(e));
    enterFloor(game, floor);
    const { state } = game;
    const map = state.world;
    const nav = navOf(map);
    const player = getPlayer(state);
    const expected = map.spawns.filter((s) => s.kind !== 'item');

    assert.deepEqual([player.x, player.y], [map.start.x + 0.5, map.start.y + 0.5]);
    assert.equal(player.kind, 'player');
    assert.equal(allActors(state).length, expected.length + 1, `${floor}층 행동체 수`);
    assert.equal(spawned.length, expected.length + 1);
    const enemies = opponentsOf(state, 'player');
    assert.deepEqual(enemies.map((e) => e.type).sort(), expected.map((s) => s.id).sort());
    for (const e of enemies) {
      assert.equal(e.kind, isBossType(e.type) ? 'boss' : 'enemy');
      assert.equal(e.ai.mode, 'idle');
      assert.deepEqual([e.ai.homeX, e.ai.homeY], [e.x, e.y]);
      assert.equal(e.hp, enemyDef(e.type).hp);
      assert.ok(circleFree(nav, e.x, e.y, e.radius), `${floor}층 ${e.type} 가 벽과 겹침 @${e.x},${e.y} r=${e.radius}`);
    }
    assert.equal(new Set(allActors(state).map((a) => a.id)).size, allActors(state).length, 'id 중복 없음');
  }
});

test('모든 층에서 적·보스의 몸이 배치 칸에 들어간다(벽과 겹치지 않는다)', () => {
  for (const seed of ['fit-a', 'fit-b', 'fit-c']) {
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      const game = createGame({ seed });
      enterFloor(game, floor);
      const nav = navOf(game.state.world);
      for (const a of allActors(game.state)) {
        assert.ok(circleFree(nav, a.x, a.y, a.radius), `${seed} ${floor}층 ${a.type} @${a.x},${a.y} r=${a.radius}`);
      }
    }
  }
});

test('플레이어는 층을 넘어가도 유지되고, 적·투사체·장판은 새로 만들어진다', () => {
  const game = createGame({ seed: 'carry' });
  enterFloor(game, 1);
  const { state } = game;
  const player = getPlayer(state);
  player.hp = 37;
  player.cooldowns.whirlwind = 999;
  state.projectiles.push({ id: 9999 });
  state.hazards.push({ id: 9998 });
  const firstFloorIds = allActors(state).map((a) => a.id);

  enterFloor(game, 2);
  const again = getPlayer(state);
  assert.equal(again, player);
  assert.equal(again.hp, 37);
  assert.equal(again.cooldowns.whirlwind, 999);
  assert.deepEqual([again.x, again.y], [state.world.start.x + 0.5, state.world.start.y + 0.5]);
  assert.deepEqual(state.projectiles, []);
  assert.deepEqual(state.hazards, []);
  const newIds = allActors(state).filter((a) => a.id !== player.id).map((a) => a.id);
  assert.ok(newIds.every((id) => !firstFloorIds.includes(id)), '이전 층의 적은 남지 않는다');
});

test('상태 버전과 새 항목', () => {
  const game = createGame({ seed: 'shape' });
  assert.equal(game.state.version, STATE_VERSION);
  assert.ok(STATE_VERSION >= 3);
  assert.deepEqual(game.state.projectiles, []);
  assert.deepEqual(game.state.hazards, []);
  assert.equal(game.state.vision, null);
  assert.deepEqual(game.state.input, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, skill: -1, dodge: false });
});

test('전투 중인 상태도 JSON 으로 왕복하면 그대로다', () => {
  const game = createGame({ seed: 'json-combat' });
  enterFloor(game, 13);
  setPhase(game, PHASE.PLAYING);
  for (const e of opponentsOf(game.state, 'player')) e.ai.provoked = true;
  for (let i = 0; i < sec(5); i++) {
    setInput(game.state, { moveX: 1, moveY: 0.3, attack: true, skill: i % 90 === 0 ? 1 : -1 });
    tick(game, DT);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(game.state)), game.state);
});

test('spawnPlayer 는 두 번 부를 수 없고, spawnEnemy 는 모르는 종류를 거부한다', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  assert.throws(() => spawnPlayer(a.state, a.bus, 3.5, 3.5), /이미/);
  assert.throws(() => spawnEnemy(a.state, a.bus, 'dragon', 3.5, 3.5), RangeError);
});

test('정의 찾기: defOf, enemyDef, statusResistOf', () => {
  const a = createArena(openRoom(14, 10), { player: { x: 5.5, y: 5.5 } });
  const golem = a.enemy('stone_golem', { x: 10.5, y: 5.5 });
  assert.equal(defOf(a.player), PLAYER);
  assert.equal(defOf(golem).name, '돌 골렘');
  assert.equal(enemyDef('nope'), null);
  assert.equal(enemyDef('toString'), null, '객체의 기본 속성 이름은 적이 아니다');
  assert.equal(statusResistOf(defOf(golem), 'poison'), 0);
  assert.equal(statusResistOf(defOf(golem), 'stun'), 0.5);
  assert.equal(statusResistOf(defOf(golem), 'burn'), 1);
  assert.equal(statusResistOf(PLAYER, 'stun'), 1);
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

test('시야: 층에 들어가면 시작점 둘레가 보이고, 움직이면 본 곳이 쌓인다', () => {
  const game = createGame({ seed: 'vision' });
  enterFloor(game, 3);
  setPhase(game, PHASE.PLAYING);
  const { state } = game;
  const { vision, world } = state;
  const startTile = world.start.y * world.width + world.start.x;

  assert.equal(vision.radius, COMBAT.visionRadius);
  assert.equal(vision.visible.length, world.width * world.height);
  assert.equal(vision.visible[startTile], 1);
  assert.equal(vision.tile, startTile);
  assert.ok(Array.isArray(vision.visible) && Array.isArray(vision.explored), 'JSON 으로 저장되는 일반 배열');
  const seenAtStart = vision.explored.reduce((a, b) => a + b, 0);
  assert.equal(seenAtStart, vision.visible.reduce((a, b) => a + b, 0));
  assert.ok(seenAtStart > 20 && seenAtStart < world.width * world.height);

  // 계단까지 걸어가면 본 곳이 늘어난다(줄어들지는 않는다).
  const player = getPlayer(state);
  const before = vision.explored.slice();
  player.x = world.stairs.x + 0.5;
  player.y = world.stairs.y + 0.5;
  tick(game, DT);
  assert.equal(vision.visible[world.stairs.y * world.width + world.stairs.x], 1);
  assert.equal(vision.visible[startTile], 0, '멀어진 시작점은 지금은 보이지 않는다');
  assert.equal(vision.explored[startTile], 1, '하지만 본 적은 있다');
  for (let i = 0; i < before.length; i++) assert.ok(vision.explored[i] >= before[i]);
  assert.ok(vision.explored.reduce((a, b) => a + b, 0) > seenAtStart);
  assert.equal(isVisible(state, player.x, player.y), true);
  assert.equal(isVisible(state, world.start.x + 0.5, world.start.y + 0.5), false);
  assert.equal(isVisible(state, -5, -5), false);
});

test('시야: 같은 칸 안에서 움직이는 동안에는 다시 계산하지 않는다', () => {
  const a = createArena(openRoom(20, 12), { player: { x: 10.2, y: 6.2 } });
  const vision = a.state.vision;
  const marker = vision.visible;
  vision.visible[0] = 7; // 다시 계산하면 0/1 로 덮어쓰인다.
  a.step(3, { moveX: 1, moveY: 0 });
  assert.ok(Math.floor(a.player.x) === 10);
  assert.equal(vision.visible[0], 7, '칸이 바뀌지 않았으므로 그대로');
  a.step(sec(0.3), { moveX: 1, moveY: 0 });
  assert.ok(Math.floor(a.player.x) > 10);
  assert.equal(vision.visible, marker, '배열은 다시 만들지 않고 제자리에서 고친다');
  assert.ok(vision.visible[0] === 0 || vision.visible[0] === 1);
});

test('시야: 새 층에 들어가면 본 곳 기록이 초기화된다', () => {
  const game = createGame({ seed: 'vision-reset' });
  enterFloor(game, 1);
  const first = game.state.vision;
  enterFloor(game, 2);
  assert.notEqual(game.state.vision, first);
  assert.equal(game.state.vision.explored.length, game.state.world.width * game.state.world.height);
});
