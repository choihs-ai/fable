import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENEMIES } from '../../../data/enemies.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { startAbility } from '../../../src/logic/combat/abilities.js';
import { dealDamage } from '../../../src/logic/combat/damage.js';
import { applyStatus } from '../../../src/logic/combat/statuses.js';
import { allActors } from '../../../src/logic/entities/actors.js';
import { lineOfSight } from '../../../src/logic/world/los.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const modes = (a, id) => a.events(EVENTS.AGGRO_CHANGED).filter((e) => e.id === id).map((e) => e.mode);

/** 넓은 방에 맞아도 죽지 않는 플레이어를 세운다. */
function duel(type, enemyAt, { player = { x: 8.5, y: 10.5 }, rows = openRoom(34, 21), alerted = true } = {}) {
  const a = createArena(rows, { player });
  a.player.maxHp = a.player.hp = 1_000_000;
  // 맞아도 밀려나지 않게 한다(적의 움직임만 보려는 테스트다).
  a.player.mass = 1e9;
  const enemy = a.enemy(type, enemyAt, { alerted });
  return { ...a, enemy };
}

// ── 어그로 ──────────────────────────────────────────────────────────────────

test('어그로: 반경 안에서 시야가 닿으면 전투, 반경 밖이면 대기', () => {
  const near = duel('skeleton', { x: 14.5, y: 10.5 }, { alerted: false });
  near.step(sec(0.3));
  assert.equal(near.enemy.ai.mode, 'combat');
  assert.deepEqual(modes(near, near.enemy.id), ['combat']);

  const far = duel('skeleton', { x: 17.5, y: 10.5 }, { alerted: false });
  far.step(sec(3));
  assert.equal(far.enemy.ai.mode, 'idle');
  assert.deepEqual([far.enemy.x, far.enemy.y], [17.5, 10.5], '대기 중에는 움직이지 않는다');
});

test('어그로: 벽에 가려 시야가 닿지 않으면 가까워도 대기', () => {
  const rows = [
    '###########',
    '#....#....#',
    '#....#....#',
    '#....#....#',
    '#.........#',
    '###########',
  ];
  const a = duel('skeleton', { x: 7.5, y: 1.5 }, { rows, player: { x: 3.5, y: 1.5 }, alerted: false });
  a.step(sec(2));
  assert.equal(a.enemy.ai.mode, 'idle');
});

test('어그로: 종류마다 반경이 다르다 — 매복하는 거미는 아주 가까워야 덤빈다', () => {
  assert.equal(ENEMIES.cave_spider.aggroRadius, 4);
  const waiting = duel('cave_spider', { x: 14.0, y: 10.5 }, { alerted: false });
  waiting.step(sec(2));
  assert.equal(waiting.enemy.ai.mode, 'idle', '5.5칸 — 해골이라면 덤볐을 거리');

  const sprung = duel('cave_spider', { x: 11.5, y: 10.5 }, { alerted: false });
  sprung.step(sec(0.3));
  assert.equal(sprung.enemy.ai.mode, 'combat');
});

// ── 리쉬와 복귀 ──────────────────────────────────────────────────────────────

test('리쉬가 없다: 한번 싸우기 시작한 적은 플레이어가 멀리 달아나도, 시야를 잃어도 끝까지 쫓는다', () => {
  const a = duel('skeleton', { x: 6.5, y: 10.5 }, { player: { x: 9.5, y: 10.5 } });
  a.step(sec(0.3));
  assert.equal(a.enemy.ai.mode, 'combat');
  a.player.x = 31.5;
  a.step(sec(6));
  assert.equal(a.enemy.ai.mode, 'combat');
  assert.ok(a.enemy.x > 15, `적 x=${a.enemy.x.toFixed(1)}`);
  assert.deepEqual(modes(a, a.enemy.id), ['combat'], '전투에 들어간 뒤로는 상태가 바뀌지 않는다');
});

test('깨워진 채로 만들어진 적(방 전투의 적)은 멀리 있어도 곧바로 싸운다', () => {
  const a = duel('skeleton', { x: 30.5, y: 10.5 }, { player: { x: 3.5, y: 10.5 }, alerted: true });
  a.step(2);
  assert.equal(a.enemy.ai.mode, 'combat');
  a.step(sec(2));
  assert.ok(a.enemy.x < 27, '다가온다');
});

test('보스도 멀리 달아난 플레이어를 계속 쫓는다', () => {
  const a = duel('bone_warden', { x: 5.5, y: 10.5 }, { player: { x: 9.5, y: 10.5 } });
  a.step(sec(0.3));
  a.player.x = 31.5;
  a.step(sec(8));
  assert.equal(a.enemy.ai.mode, 'combat');
  assert.ok(a.enemy.x > 15, `보스 x=${a.enemy.x.toFixed(1)}`);
});

test('플레이어가 죽으면 적은 그 자리에 멈춰 선다', () => {
  const a = duel('skeleton', { x: 12.5, y: 10.5 });
  a.step(sec(1));
  a.player.dead = true;
  a.step(sec(0.1));
  const at = [a.enemy.x, a.enemy.y];
  a.step(sec(1));
  assert.deepEqual([a.enemy.x, a.enemy.y], at);
});

// ── 행동 방식별 특징 ─────────────────────────────────────────────────────────

test('근접: 다가가서 때리고, 사거리 안에서는 멈춰 선다', () => {
  const a = duel('skeleton', { x: 16.5, y: 10.5 });
  a.step(sec(6));
  const d = dist(a.enemy, a.player);
  assert.ok(d < 1.3 && d > 0.6, `거리 ${d.toFixed(2)}`);
  assert.ok(a.player.maxHp - a.player.hp >= 16, '두 번 이상 맞았다');
  assert.ok(a.events(EVENTS.ABILITY_WINDUP).every((e) => e.ability === 'strike'));
});

test('원거리: 거리를 유지하며 쏘고, 붙으면 물러난다', () => {
  const a = duel('kobold', { x: 20.5, y: 10.5 });
  a.step(sec(6));
  const p = ENEMIES.kobold.aiParams;
  assert.ok(a.events(EVENTS.PROJECTILE_FIRED).length >= 2);
  assert.ok(dist(a.enemy, a.player) <= p.max + 0.5 && dist(a.enemy, a.player) >= p.min - 0.5, `거리 ${dist(a.enemy, a.player).toFixed(2)}`);

  // 플레이어를 바로 옆에 놓으면 벌어진다.
  a.player.x = a.enemy.x - 1;
  a.player.y = a.enemy.y;
  a.step(sec(2));
  assert.ok(dist(a.enemy, a.player) > p.min - 0.5, `물러난 뒤 거리 ${dist(a.enemy, a.player).toFixed(2)}`);
});

test('돌진: 예고 후 직선으로 돌진하고, 벽에 부딪히면 스스로 기절한다', () => {
  const a = duel('fungal_brute', { x: 15.5, y: 10.5 });
  a.step(sec(0.2));
  const windup = a.events(EVENTS.ABILITY_WINDUP)[0];
  assert.equal(windup.ability, 'charge');
  assert.equal(a.enemy.action.phase, 'windup');
  // 예고 중에 플레이어가 옆으로 비킨다 → 돌진은 처음 겨눈 방향으로 간다.
  a.player.y = 16.5;
  a.step(sec(0.7));
  assert.ok(a.enemy.dash, '돌진 중');
  assert.ok(Math.abs(a.enemy.dash.dirY) < 0.01 && a.enemy.dash.dirX < 0, '방향은 예고 때 고정');
  a.step(sec(1));
  assert.equal(a.player.hp, a.player.maxHp, '비킨 플레이어는 맞지 않는다');

  // 벽을 향해 돌진시키면 부딪혀 기절한다.
  const b = duel('fungal_brute', { x: 4.5, y: 10.5 }, { player: { x: 30.5, y: 3.5 } });
  b.enemy.ai.mode = 'combat';
  assert.equal(startAbility(b.state, b.bus, b.enemy, 'charge', -1, 0, 0, 10.5), true);
  b.step(sec(1.2), null);
  assert.ok(b.enemy.statuses.stun, '벽에 부딪혀 기절');
  assert.equal(b.enemy.dash, null);
});

test('소환: 하수인을 부르되 상한을 넘지 않고, 하수인은 곧바로 싸운다', () => {
  const a = duel('cultist', { x: 16.5, y: 10.5 });
  let maxMinions = 0;
  for (let i = 0; i < sec(30); i++) {
    a.step(1);
    const minions = allActors(a.state).filter((x) => x.summonerId === a.enemy.id && !x.dead);
    maxMinions = Math.max(maxMinions, minions.length);
    for (const m of minions) assert.notEqual(m.ai.mode, 'return');
  }
  assert.equal(maxMinions, 3, '상한 3');
  const spawned = a.events(EVENTS.ENTITY_SPAWNED).filter((e) => e.summonerId === a.enemy.id);
  assert.ok(spawned.length >= 3 && spawned.every((e) => e.type === 'skeleton'));
  assert.ok(dist(a.enemy, a.player) > 2, '소환사는 붙어 싸우지 않는다');
});

test('치고 빠지기: 물고 나면 물러났다가 다시 오고, 체력이 낮아지면 한 번 크게 달아난다', () => {
  const a = duel('rat', { x: 11.5, y: 10.5 });
  let bit = false;
  let maxAfterBite = 0;
  for (let i = 0; i < sec(4); i++) {
    a.step(1);
    if (a.player.hp < a.player.maxHp) bit = true;
    if (bit) maxAfterBite = Math.max(maxAfterBite, dist(a.enemy, a.player));
  }
  assert.ok(bit, '물었다');
  assert.ok(maxAfterBite > 2.5, `문 뒤 최대 거리 ${maxAfterBite.toFixed(2)}`);
  assert.ok(a.events(EVENTS.ABILITY_USED).length >= 2, '다시 와서 또 문다');

  assert.equal(a.enemy.ai.fled, false);
  dealDamage(a.state, a.bus, a.enemy, a.enemy.hp - 3, { sourceId: a.player.id });
  a.step(sec(1.5));
  assert.equal(a.enemy.ai.fled, true);
  assert.ok(dist(a.enemy, a.player) > 3.5, `도주 거리 ${dist(a.enemy, a.player).toFixed(2)}`);
});

test('자폭: 붙으면 터져서 피해와 독을 주고 스스로 죽는다. 터지기 전에 죽이면 터지지 않는다', () => {
  const a = duel('sporeling', { x: 13.5, y: 10.5 });
  a.step(sec(4));
  assert.equal(a.state.entities.byId[a.enemy.id], undefined);
  assert.equal(a.player.maxHp - a.player.hp >= 18, true);
  assert.equal(a.player.statuses.poison.stacks, 2);
  assert.deepEqual(a.events(EVENTS.ENTITY_DIED).map((e) => [e.type, e.killerId]), [['sporeling', a.enemy.id]]);

  const b = duel('sporeling', { x: 13.5, y: 10.5 });
  for (let i = 0; i < sec(4) && !b.enemy.action; i++) b.step(1);
  assert.equal(b.enemy.action?.ability, 'explode');
  dealDamage(b.state, b.bus, b.enemy, 999, { sourceId: b.player.id });
  b.step(sec(1));
  assert.equal(b.player.hp, b.player.maxHp);
});

test('방어/탱커: 몸을 천천히 돌린다 — 뒤로 돌아가면 한동안 등을 보인다', () => {
  const a = duel('stone_golem', { x: 12.5, y: 10.5 });
  a.step(sec(1.5));
  assert.ok(a.enemy.facingX < -0.95, '플레이어(왼쪽)를 본다');
  // 플레이어가 순식간에 반대편으로.
  a.player.x = a.enemy.x + 3;
  a.player.y = a.enemy.y + 0.5;
  a.step(3);
  assert.ok(a.enemy.facingX < 0, '아직 등을 보이고 있다');
  // 등 뒤에서 온 피해는 막지 못한다.
  const before = a.enemy.hp;
  dealDamage(a.state, a.bus, a.enemy, 20, { sourceId: a.player.id, fromX: a.player.x, fromY: a.player.y });
  assert.equal(before - a.enemy.hp, 14, '방어력 12 만 적용된다(정면 방어 없음)');
  a.step(sec(2));
  assert.ok(a.enemy.facingX > 0.8, '결국 돌아본다');
});

test('순간이동: 붙으면 자리를 옮기고, 옮긴 자리는 정해진 거리 안에서 시야가 닿는 곳이다', () => {
  const a = duel('shade', { x: 10.5, y: 10.5 });
  const blink = ENEMIES.shade.abilities.blink.effects[0];
  a.step(sec(8));
  const jumps = a.events(EVENTS.ENTITY_TELEPORTED);
  assert.ok(jumps.length >= 2, `순간이동 ${jumps.length}회`);
  for (const j of jumps) {
    const d = Math.hypot(j.x - a.player.x, j.y - a.player.y);
    assert.ok(d >= blink.min - 0.01 && d <= blink.max + 0.01, `거리 ${d.toFixed(2)}`);
    assert.ok(lineOfSight(a.nav, j.x, j.y, a.player.x, a.player.y));
  }
  assert.ok(a.events(EVENTS.PROJECTILE_FIRED).length >= 2, '사이사이 쏜다');
});

test('매복: 덮쳐서 독을 묻히고 문다', () => {
  const a = duel('cave_spider', { x: 12.0, y: 10.5 });
  a.step(sec(5));
  const used = a.events(EVENTS.ABILITY_USED).map((e) => e.ability);
  assert.ok(used.includes('leap') && used.includes('bite'), `쓴 기술: ${used}`);
  assert.ok(a.player.statuses.poison);
});

test('선회 강습: 주위를 돌다가 꿰뚫고 지나가며, 구석에 붙으면 근접 공격을 한다', () => {
  const a = duel('bat', { x: 13.5, y: 10.5 });
  let crossed = false;
  let prevSide = Math.sign(a.enemy.x - a.player.x);
  for (let i = 0; i < sec(10); i++) {
    a.step(1);
    if (a.enemy.dash) {
      const side = Math.sign(a.enemy.x - a.player.x);
      if (side !== 0 && side !== prevSide) crossed = true;
      prevSide = side;
    }
  }
  assert.ok(a.events(EVENTS.ABILITY_USED).filter((e) => e.ability === 'dive').length >= 2);
  assert.ok(crossed, '강습으로 플레이어를 지나쳤다');

  // 막다른 복도 끝에서 플레이어와 붙어 있으면(돌 자리도 물러날 자리도 없음) 근접 공격을 한다.
  const rows = ['#######', '#.....#', '#######'];
  const b = duel('gargoyle', { x: 1.5, y: 1.5 }, { rows, player: { x: 2.8, y: 1.5 } });
  b.step(sec(3));
  assert.ok(b.events(EVENTS.ABILITY_USED).some((e) => e.ability === 'claw'));
});

test('분열: 슬라임이 죽으면 작은 슬라임 둘이 나오고, 그것들은 다시 분열하지 않는다', () => {
  const a = duel('slime', { x: 12.5, y: 10.5 });
  a.step(sec(0.5));
  dealDamage(a.state, a.bus, a.enemy, 999, { sourceId: a.player.id });
  a.step(1);
  const lets = allActors(a.state).filter((x) => x.type === 'slimelet');
  assert.equal(lets.length, 2);
  for (const s of lets) dealDamage(a.state, a.bus, s, 999, { sourceId: a.player.id });
  a.step(1);
  assert.equal(allActors(a.state).filter((x) => x.faction === 'enemy').length, 0);
});

test('같은 편끼리는 좁은 복도에서 길을 막고 서 있어도 서로를 지나간다', () => {
  const rows = ['####################', '#..................#', '####################'];
  const a = createArena(rows, { player: { x: 18.5, y: 1.5 } });
  a.player.maxHp = a.player.hp = 1_000_000;
  // 해골은 오른쪽의 플레이어에게 가는데, 한 칸 폭 복도 한가운데에 좀비가 서 있다(플레이어가 멀어 깨어나지 않는다).
  const chaser = a.enemy('skeleton', { x: 6.5, y: 1.5 }, { alerted: true });
  const sleeper = a.enemy('zombie', { x: 10.5, y: 1.5 });
  let closest = Infinity;
  for (let i = 0; i < sec(8); i++) {
    a.step(1);
    closest = Math.min(closest, Math.abs(chaser.x - sleeper.x));
  }
  assert.ok(closest < 0.5, `두 몸이 겹쳐 지나갔어야 함(가장 가까웠을 때 ${closest.toFixed(2)}칸)`);
  assert.equal(sleeper.ai.mode, 'idle');
  assert.ok(chaser.x > 16.5, `해골 x=${chaser.x.toFixed(2)}`);
});

// ── 보스 ────────────────────────────────────────────────────────────────────

test('보스가 죽으면 그 보스가 소환한 적도 함께 죽는다', () => {
  const a = duel('bone_warden', { x: 16.5, y: 10.5 });
  startAbility(a.state, a.bus, a.enemy, 'raise_dead', 0, 1, a.player.x, a.player.y);
  a.step(sec(1.1));
  const minions = allActors(a.state).filter((x) => x.summonerId === a.enemy.id);
  assert.equal(minions.length, 2);

  for (let i = 0; i < 3 && !a.enemy.dead; i++) {
    dealDamage(a.state, a.bus, a.enemy, 100000, { sourceId: a.player.id });
    a.step(sec(1.6));
  }
  assert.equal(allActors(a.state).filter((x) => x.faction === 'enemy').length, 0);
  assert.equal(a.events(EVENTS.ENTITY_DIED).length, 3);
});

test('보스: 페이즈가 바뀌면 그 페이즈의 패턴만 쓴다', () => {
  const a = duel('abyss_lord', { x: 14.5, y: 10.5 });
  const usedIn = (from, to) => new Set(a.events(EVENTS.ABILITY_USED).filter((e) => e.actorId === a.enemy.id && e.tick > from && e.tick <= to).map((e) => e.ability));

  a.step(sec(25));
  const t1 = a.state.tick;
  const phase1 = usedIn(0, t1);
  assert.ok([...phase1].every((x) => ['void_sweep', 'shadow_bolts'].includes(x)), `1페이즈: ${[...phase1]}`);
  assert.equal(phase1.size, 2, '1페이즈의 두 패턴을 모두 쓴다');

  dealDamage(a.state, a.bus, a.enemy, 100000, { sourceId: a.player.id });
  assert.equal(a.enemy.ai.phase, 1);
  const tStart = a.state.tick;
  a.step(sec(2));
  assert.equal(usedIn(tStart, a.state.tick).size, 0, '전환 중에는 아무것도 하지 않는다');
  a.step(sec(40));
  const phase2 = usedIn(tStart, a.state.tick);
  assert.ok([...phase2].every((x) => ['blink', 'bolt_nova', 'summon_shades', 'shadow_bolts'].includes(x)), `2페이즈: ${[...phase2]}`);
  assert.ok(phase2.has('bolt_nova') && phase2.has('summon_shades'), `2페이즈: ${[...phase2]}`);
  // 전방위 탄막은 8발.
  const novaTick = a.events(EVENTS.ABILITY_USED).find((e) => e.ability === 'bolt_nova').tick;
  assert.equal(a.events(EVENTS.PROJECTILE_FIRED).filter((e) => e.tick === novaTick).length, 8);
});

test('장판: 예고 뒤에 터지고, 그 전에 벗어나면 맞지 않는다', () => {
  const a = duel('cinder_drake', { x: 20.5, y: 10.5 });
  a.enemy.ai.mode = 'combat';
  a.enemy.ai.nextPatternAt = Infinity; // 보스가 스스로 패턴을 쓰지 않게 한다.
  a.enemy.speed = 0;
  startAbility(a.state, a.bus, a.enemy, 'fire_rain', -1, 0, a.player.x, a.player.y);
  a.step(sec(0.6) + 1);
  const spawned = a.events(EVENTS.HAZARD_SPAWNED);
  assert.equal(spawned.length, 3);
  assert.equal(a.state.hazards.length, 3);
  assert.equal(a.player.hp, a.player.maxHp, '예고 중에는 피해가 없다');

  a.step(sec(0.9));
  assert.equal(a.events(EVENTS.HAZARD_TRIGGERED).length, 3);
  assert.equal(a.state.hazards.length, 0);
  assert.equal(a.player.maxHp - a.player.hp, 12, '가운데 장판 하나에만 맞는다');
  assert.ok(a.player.statuses.burn);

  // 다시 쓰고 이번에는 벗어난다.
  a.enemy.cooldowns.fire_rain = 0;
  a.enemy.action = null;
  const hp = a.player.hp;
  startAbility(a.state, a.bus, a.enemy, 'fire_rain', -1, 0, a.player.x, a.player.y);
  a.step(sec(0.6) + 1);
  a.player.y -= 5;
  a.step(sec(1));
  // 화상의 지속 피해만 들어온다.
  assert.ok(hp - a.player.hp <= 9, `피해 ${hp - a.player.hp}`);
});
