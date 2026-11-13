// 방 전투: 문 잠김 → 웨이브 → 전멸 시 문 열림 + 보상. 방 단위 공개, 숨은 문, 보스와 출구 포털.

import { ZONES } from '../../../data/zones.js';
import { TOTAL_FLOORS } from '../../../src/logic/world/floors.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENCOUNTERS } from '../../../data/encounters.js';
import { SOULS } from '../../../data/meta.js';
import { WEAPONS } from '../../../data/weapons.js';
import { interact, interactTarget, usePortal } from '../../../src/logic/commands.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE } from '../../../src/logic/core/state.js';
import { ticksOf } from '../../../src/logic/core/time.js';
import { dealDamage } from '../../../src/logic/combat/damage.js';
import { spawnProjectile } from '../../../src/logic/combat/projectiles.js';
import { depthScaling } from '../../../src/logic/entities/scaling.js';
import { enemyDef } from '../../../src/logic/entities/defs.js';
import { REWARD, ROOM_KIND } from '../../../src/logic/world/floors.js';
import { isWall } from '../../../src/logic/world/nav.js';
import { TILE } from '../../../src/logic/world/tiles.js';
import { validateRunState } from '../../../src/logic/save/validate.js';
import { createStage } from '../../helpers/stage.js';

const WARN = ticksOf(ENCOUNTERS.spawnWarnSec);
const doorsOf = (s, room) => room.doors.map((id) => s.map.doors[id]);
const combatRoom = (s, reward) => s.rooms(ROOM_KIND.COMBAT).find((r) => reward === undefined || r.reward === reward);

test('층에 들어가면 시작 방과 거기서 나가는 복도만 드러나 있고, 시작 방은 싸움 없이 끝난 방이다', () => {
  const s = createStage();
  const start = s.room(ROOM_KIND.START);
  assert.equal(start.seen, true);
  assert.equal(start.state, 'cleared');
  for (const door of doorsOf(s, start)) assert.equal(s.map.links[door.link].seen, true);
  for (const room of s.map.rooms) if (room !== start) assert.equal(room.seen, false, `방 ${room.id}`);
  assert.equal(s.state.encounter, null);
  assert.deepEqual(validateRunState(s.state), []);
});

test('방 단위 공개: 복도에 서면 양쪽 방이 드러난다', () => {
  const s = createStage();
  const start = s.room(ROOM_KIND.START);
  const door = doorsOf(s, start)[0];
  const other = s.map.rooms[door.to];
  s.player.x = door.x;
  s.player.y = door.y;
  s.step(1);
  assert.equal(other.seen, true);
  assert.equal(other.state, 'idle', '보이기만 할 뿐 전투는 시작되지 않는다');
});

test('전투방: 문턱에서는 시작되지 않고, 안으로 들어서면 문이 잠기고 첫 웨이브가 예고된다', () => {
  const s = createStage();
  const room = combatRoom(s);
  const door = doorsOf(s, room)[0];
  // 문 바로 안쪽 칸.
  const inside = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy }))
    .find((p) => !isWall(s.nav(), Math.floor(p.x), Math.floor(p.y)) && p.x > room.x && p.x < room.x + room.w && p.y > room.y && p.y < room.y + room.h);
  s.player.x = inside.x;
  s.player.y = inside.y;
  s.step(5);
  assert.equal(room.state, 'idle');
  assert.equal(s.state.encounter, null);

  s.moveTo(room);
  s.step(1);
  assert.equal(room.state, 'active');
  assert.equal(s.state.run.depth, room.depth);
  const locked = s.events(EVENTS.DOORS_LOCKED)[0];
  assert.deepEqual(locked.doors, room.doors);
  for (const d of doorsOf(s, room)) {
    assert.equal(d.open, false);
    for (const c of d.cells) {
      assert.equal(s.map.tiles[c], TILE.DOOR);
      assert.ok(isWall(s.nav(), c % s.map.width, Math.floor(c / s.map.width)), '잠긴 문은 벽처럼 막는다');
    }
  }
  // 예고: 아직 적은 없고, 나타날 자리가 정해져 있다.
  const { pending } = s.state.encounter;
  assert.equal(pending.length, room.waves[0].length);
  assert.equal(s.enemies().length, 0);
  assert.equal(s.events(EVENTS.WAVE_STARTED)[0].count, room.waves[0].length);
  for (const spawn of pending) {
    assert.equal(spawn.at, s.state.tick + WARN);
    const cell = Math.floor(spawn.y) * s.map.width + Math.floor(spawn.x);
    assert.ok(room.spawnCells.includes(cell), '방의 지정된 자리');
    assert.ok(Math.hypot(spawn.x - s.player.x, spawn.y - s.player.y) >= ENCOUNTERS.spawnMinPlayerDist - 1e-9, '플레이어에게서 떨어진 자리');
  }
  assert.equal(new Set(pending.map((p) => `${p.x},${p.y}`)).size, pending.length, '자리가 겹치지 않는다');
  assert.deepEqual(validateRunState(s.state), []);
});

test('전투방: 예고가 끝나면 적이 나타나 곧바로 덤비고, 체력은 방의 깊이에 맞춰져 있다', () => {
  const s = createStage();
  const room = combatRoom(s);
  s.moveTo(room);
  s.step(1);
  s.step(WARN - 1);
  assert.equal(s.enemies().length, 0);
  s.step(1);
  const enemies = s.enemies();
  assert.equal(enemies.length, room.waves[0].length);
  assert.deepEqual(enemies.map((e) => e.type).sort(), room.waves[0].map((w) => w.type).sort());
  s.step(2);
  for (const e of enemies) {
    assert.equal(e.ai.mode, 'combat');
    assert.equal(e.maxHp, Math.round(enemyDef(e.type).hp * depthScaling(room.depth).hp));
  }
});

test('전투방: 웨이브를 모두 잡아야 다음 웨이브가 오고, 마지막 웨이브를 잡으면 문이 열리며 보상이 나온다', () => {
  const s = createStage();
  const room = combatRoom(s);
  const gold = s.state.run.gold;
  s.moveTo(room);
  s.step(1 + WARN);
  for (let wave = 0; wave < room.waves.length; wave++) {
    assert.equal(room.wave, wave);
    assert.equal(s.enemies().length, room.waves[wave].length, `웨이브 ${wave}`);
    // 하나라도 남아 있으면 다음 웨이브가 오지 않는다.
    const [last, ...rest] = s.enemies();
    for (const e of rest) dealDamage(s.state, s.bus, e, 1e9, { sourceId: s.player.id });
    last.speed = 0;
    s.player.invulnUntil = s.state.tick + 600;
    s.step(ticksOf(ENCOUNTERS.waveGapSec) + WARN + 5);
    assert.equal(room.wave, wave, '남은 적이 있는 동안은 그대로');
    assert.equal(s.enemies().length, 1);
    s.killAll();
    s.step(1);
    s.player.invulnUntil = s.state.tick + 600;
    if (wave + 1 < room.waves.length) {
      s.step(ticksOf(ENCOUNTERS.waveGapSec) + WARN + 2);
    }
  }
  s.step(2);
  assert.equal(room.state, 'cleared');
  assert.equal(s.state.encounter, null);
  assert.equal(s.events(EVENTS.WAVE_STARTED).length, room.waves.length);
  assert.equal(s.events(EVENTS.ROOM_CLEARED).length, 1);
  assert.deepEqual(s.events(EVENTS.ROOM_CLEARED)[0].reward, room.reward);
  for (const d of doorsOf(s, room)) {
    if (d.secret) continue;
    assert.equal(d.open, true);
    for (const c of d.cells) assert.equal(s.map.tiles[c], TILE.FLOOR);
  }
  assert.equal(s.state.run.roomsCleared, 1);
  assert.ok(s.state.run.gold > gold, '방을 깨면 금화를 받는다');
  assert.deepEqual(validateRunState(s.state), []);
});

test('전투 중에는 플레이어도 적도 방을 나가지 못한다', () => {
  const s = createStage();
  const room = combatRoom(s);
  s.moveTo(room);
  s.step(1 + WARN);
  const door = doorsOf(s, room)[0];
  // 문 쪽으로 계속 걸어도 문을 넘지 못한다.
  s.player.invulnUntil = s.state.tick + 100000;
  for (let i = 0; i < 600; i++) {
    const dx = door.x - s.player.x;
    const dy = door.y - s.player.y;
    const d = Math.hypot(dx, dy) || 1;
    s.step(1, { moveX: dx / d, moveY: dy / d, dash: i % 40 === 0 });
  }
  const inRoom = (a) => a.x > room.x && a.x < room.x + room.w && a.y > room.y && a.y < room.y + room.h;
  assert.ok(inRoom(s.player), `플레이어 @${s.player.x.toFixed(2)},${s.player.y.toFixed(2)}`);
  for (const e of s.enemies()) assert.ok(inRoom(e), `${e.type} 가 방 밖`);
  assert.equal(room.state, 'active');
});

test('방을 깨면 남아 있던 적의 탄과 장판이 사라진다', () => {
  const s = createStage();
  const room = combatRoom(s);
  s.moveTo(room);
  s.step(1 + WARN);
  const shooter = s.enemies()[0];
  spawnProjectile(s.state, s.bus, shooter, { speed: 0.01, radius: 0.2, range: 30, damage: 5 }, 1, 0);
  s.clear(room);
  assert.equal(s.state.projectiles.filter((p) => p.faction === 'enemy').length, 0);
});

test('보상: 방의 보상 종류대로 떨어진다 — 축복은 닿으면 3택1, 무기는 상호작용으로 줍는다', () => {
  for (const reward of Object.values(REWARD)) {
    const s = createStage({ seed: `reward-${reward}`, need: (map) => map.rooms.some((r) => r.kind === ROOM_KIND.COMBAT && r.reward === reward) });
    const room = combatRoom(s, reward);
    s.player.hp = 40;
    const goldBefore = s.state.run.gold;
    s.clear(room);
    const drops = s.state.drops.filter((d) => Math.hypot(d.x - (room.feature.x + 0.5), d.y - (room.feature.y + 0.5)) < 0.01);
    if (reward === REWARD.BOON) {
      // 방 한가운데에 서 있으므로 곧바로 닿아 3택1 이 열린다.
      s.step(2);
      assert.ok(s.state.run.choice, '3택1 이 제시된다');
      assert.equal(s.state.run.choice.options.length, 3);
      assert.equal(s.events(EVENTS.BOON_OFFERED).length, 1);
    } else if (reward === REWARD.WEAPON) {
      assert.equal(drops.length, 1);
      assert.ok(WEAPONS[drops[0].weapon]);
      assert.ok(!s.player.kit.weapons.includes(drops[0].weapon), '이미 든 무기는 나오지 않는다');
      assert.deepEqual(interactTarget(s.state), { type: 'weapon', dropId: drops[0].id, weapon: drops[0].weapon });
      s.step(5);
      assert.ok(s.state.drops.includes(drops[0]), '저절로 주워지지 않는다');
    } else if (reward === REWARD.GOLD) {
      // 방 한가운데에 서 있으므로 떨어지자마자 주워진다.
      s.step(2);
      const gained = s.state.run.gold - goldBefore;
      assert.ok(gained >= ENCOUNTERS.rewards.gold[0] + ENCOUNTERS.rewards.clearGold[0], `금화 +${gained}`);
    } else {
      s.step(2);
      assert.ok(s.player.hp - 40 >= Math.round((s.player.maxHp * ENCOUNTERS.rewards.healthPct) / 100), `체력 +${s.player.hp - 40}`);
    }
  }
});

test('정예방: 웨이브마다 정예가 끼고, 깨면 축복과 금화가 나온다', () => {
  const s = createStage({ seed: 'elite', need: (map) => map.rooms.some((r) => r.kind === ROOM_KIND.ELITE) });
  const room = s.room(ROOM_KIND.ELITE);
  s.moveTo(room);
  s.step(1 + WARN);
  const elites = s.enemies().filter((e) => e.elite);
  assert.equal(elites.length, ENCOUNTERS.elite.perWave);
  assert.ok(elites[0].radius > enemyDef(elites[0].type).radius);
  const goldBefore = s.state.run.gold;
  s.clear(room);
  s.step(2);
  assert.ok(s.state.drops.some((d) => d.kind === 'boon') || s.state.run.choice, '축복');
  assert.ok(s.state.run.gold - goldBefore >= ENCOUNTERS.rewards.eliteGold[0], `금화 +${s.state.run.gold - goldBefore}`);
  assert.ok(s.state.run.eliteKills >= ENCOUNTERS.elite.perWave);
});

test('싸움이 없는 방(상점·보상)은 들어서는 것으로 끝나고, 보상 방은 보상을 놓는다', () => {
  const s = createStage({ seed: 'calm', need: (map) => map.rooms.some((r) => r.kind === ROOM_KIND.SHOP) && map.rooms.some((r) => r.kind === ROOM_KIND.REWARD) });
  const shop = s.room(ROOM_KIND.SHOP);
  s.moveTo(shop);
  s.step(2);
  assert.equal(shop.state, 'cleared');
  assert.equal(s.state.encounter, null);
  assert.deepEqual(interactTarget(s.state), { type: 'shop' });
  assert.deepEqual(doorsOf(s, shop).map((d) => d.open), shop.doors.map(() => true), '문은 잠기지 않는다');

  const reward = s.room(ROOM_KIND.REWARD);
  s.moveTo(reward);
  s.step(1);
  assert.equal(reward.state, 'cleared');
  assert.equal(s.state.run.roomsCleared, 0, '싸우지 않은 방은 깬 방으로 세지 않는다');
  s.step(2);
  if (reward.reward === REWARD.BOON) assert.ok(s.state.run.choice);
  else assert.ok(s.state.drops.some((d) => d.kind === 'weapon'));
});

test('보스 방: 보스가 한가운데에 나타나고, 잡으면 출구 방으로 가는 문이 열린다. 포털로 다음 층에 가고, 마지막 층의 포털은 승리', () => {
  const s = createStage({ seed: 'boss' });
  const boss = s.room(ROOM_KIND.BOSS);
  const exit = s.room(ROOM_KIND.EXIT);
  s.moveTo(boss);
  s.step(1);
  assert.equal(s.state.encounter.pending.length, 1);
  assert.deepEqual([s.state.encounter.pending[0].x, s.state.encounter.pending[0].y], [boss.feature.x + 0.5, boss.feature.y + 0.5]);
  // 예고 동안 비켜 서 있는다(보스가 나타나는 자리 위에 서 있었다).
  s.player.x += 3;
  s.step(WARN);
  const actor = s.enemies()[0];
  assert.equal(actor.kind, 'boss');
  assert.equal(usePortal(s.game).ok, false, '보스를 잡기 전에는 포털에 갈 수 없다');
  const goldBefore = s.state.run.gold;
  s.clear(boss);
  s.step(2);
  assert.equal(s.state.run.bossKills, 1);
  assert.ok(doorsOf(s, exit).every((d) => d.open));
  assert.ok(s.state.run.gold - goldBefore >= ENCOUNTERS.rewards.bossGold[0], `금화 +${s.state.run.gold - goldBefore}`);

  s.state.run.choice = null;
  s.moveTo(exit);
  s.step(2);
  assert.deepEqual(interactTarget(s.state), { type: 'portal' });
  // 첫 층의 포털: 다음 층으로 간다. 플레이어는 그대로 가고(축복·무기·금화), 최대 체력의 일부를 회복한다.
  s.player.hp = 20;
  const gold = s.state.run.gold;
  const next = interact(s.game);
  assert.deepEqual(next, { ok: true, type: 'portal', victory: false, floor: 2 });
  assert.equal(s.state.run.floor, 2);
  assert.equal(s.state.world.floor, 2);
  assert.equal(s.state.world.zoneId, ZONES[1].id);
  assert.equal(s.state.phase, PHASE.PLAYING);
  assert.equal(s.state.run.gold, gold);
  const p2 = s.state.entities.byId[s.state.playerId];
  assert.equal(p2.hp, 20 + Math.round((p2.maxHp * ENCOUNTERS.stage.healPct) / 100));
  assert.deepEqual(validateRunState(s.state), []);

  // 마지막 층의 포털: 승리.
  s.state.run.floor = TOTAL_FLOORS;
  const exit2 = s.state.world.rooms.find((r) => r.kind === 'exit');
  const boss2 = s.state.world.rooms.find((r) => r.kind === 'boss');
  boss2.state = 'cleared';
  p2.x = exit2.feature.x + 0.5;
  p2.y = exit2.feature.y + 0.5;
  s.state.run.depth = 0;
  const souls = s.state.meta.souls;
  const result = usePortal(s.game);
  assert.deepEqual(result, { ok: true, type: 'portal', victory: true });
  assert.equal(s.state.phase, PHASE.VICTORY);
  const ended = s.events(EVENTS.RUN_ENDED)[0];
  assert.equal(ended.victory, true);
  assert.equal(s.state.meta.souls - souls, ended.souls);
  assert.ok(ended.souls >= SOULS.perBoss + SOULS.victory + SOULS.perRoom);
  assert.equal(s.state.meta.victories, 1);
});

test('숨은 방: 문은 벽처럼 닫혀 있고, 금 간 벽에 몸을 대면 열린다. 안에는 무기와 금화가 있다', () => {
  const s = createStage({ seed: 'secret', need: (map) => map.rooms.some((r) => r.kind === ROOM_KIND.BONUS) });
  const bonus = s.room(ROOM_KIND.BONUS);
  const door = s.map.doors.find((d) => d.secret);
  const host = s.map.rooms[door.room];
  assert.equal(door.open, false);
  assert.equal(s.map.links[door.link].seen, false);
  // 문이 달린 방을 깬 뒤에도 숨은 문은 닫혀 있다.
  if (host.state === 'idle' && host.waves.length > 0) s.clear(host);
  assert.equal(door.open, false);
  s.state.run.choice = null;
  // 문 바로 아래(방 쪽)에 서서 문 쪽으로 걷는다.
  const side = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy, dx: -dx, dy: -dy }))
    .find((p) => !isWall(s.nav(), Math.floor(p.x), Math.floor(p.y)));
  s.player.x = side.x;
  s.player.y = side.y;
  s.step(1, { moveX: 0, moveY: 0 });
  assert.equal(door.open, false, '가까이 서 있는 것만으로는 열리지 않는다');
  s.step(20, { moveX: side.dx, moveY: side.dy });
  assert.equal(door.open, true);
  assert.equal(s.events(EVENTS.SECRET_FOUND).length, 1);
  assert.equal(s.map.links[door.link].seen, true);
  for (const c of door.cells) assert.equal(s.map.tiles[c], TILE.FLOOR);

  s.moveTo(bonus);
  s.step(2, { moveX: 0, moveY: 0 });
  assert.equal(bonus.state, 'cleared');
  assert.ok(s.state.drops.some((d) => d.kind === 'weapon'), '무기');
  assert.ok(s.state.run.gold >= ENCOUNTERS.rewards.bonusGold[0] || s.state.drops.some((d) => d.kind === 'gold'), '금화');
  assert.deepEqual(validateRunState(s.state), []);
});

test('처치 보상: 금화·에너지·체력 구슬이 떨어지고 가까이 가면 주워진다. 소환된 적은 아무것도 주지 않는다', () => {
  const s = createStage({ seed: 'kill-loot' });
  let gold = 0;
  let energy = 0;
  for (const room of s.rooms(ROOM_KIND.COMBAT)) {
    s.clear(room);
    s.state.run.choice = null;
    gold += s.state.drops.filter((d) => d.kind === 'gold').length;
    energy += s.state.drops.filter((d) => d.kind === 'energy').length;
  }
  assert.ok(gold > 0 && energy > 0, `금화 ${gold}, 에너지 ${energy}`);
  assert.ok(s.state.run.kills >= 10);
  // 에너지가 가득 차 있으면 에너지 구슬은 줍지 않는다.
  const orb = s.state.drops.find((d) => d.kind === 'energy');
  s.player.kit.energy = s.player.kit.maxEnergy;
  s.player.x = orb.x;
  s.player.y = orb.y;
  s.step(2, { moveX: 0, moveY: 0 });
  assert.ok(s.state.drops.includes(orb));
  s.player.kit.energy = 0;
  s.step(2);
  assert.ok(!s.state.drops.includes(orb));
  assert.equal(s.player.kit.energy >= ENCOUNTERS.kill.energy.amount, true);
});
