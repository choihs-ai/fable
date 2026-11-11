import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOSSES } from '../../../data/bosses.js';
import { COMBAT } from '../../../data/combat.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { dealDamage, heal } from '../../../src/logic/combat/damage.js';
import { applyStatus } from '../../../src/logic/combat/statuses.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

/** 플레이어 없이 적만 있는 방(적은 대기 상태로 가만히 있는다). */
function lone(type) {
  const a = createArena(openRoom(24, 16));
  const target = a.enemy(type, { x: 12.5, y: 8.5 });
  return { ...a, target, hit: (amount, opts) => dealDamage(a.state, a.bus, target, amount, opts) };
}

test('피해: 체력이 줄고 이벤트가 나간다. 피해는 정수로 반올림되고 최소 1', () => {
  const { target, hit, events } = lone('zombie');
  assert.equal(hit(7), 7);
  assert.equal(hit(2.6), 3);
  assert.equal(hit(0.2), 1);
  assert.equal(hit(0), 0);
  assert.equal(hit(-5), 0);
  assert.equal(target.hp, 60 - 11);
  assert.deepEqual(events(EVENTS.DAMAGE_DEALT).map((e) => e.amount), [7, 3, 1]);
  assert.equal(events(EVENTS.DAMAGE_DEALT)[0].hp, 53);
});

test('방어력은 피해를 비율로 줄이고(K ÷ (K + 방어력)), 그래도 최소 1 은 들어간다', () => {
  const { target, hit } = lone('dark_knight');
  const k = COMBAT.armorK;
  assert.equal(target.armor, 8);
  // 뒤(바라보는 방향의 반대)에서 때려 정면 방어를 피한다.
  const behind = { fromX: target.x, fromY: target.y - 2 };
  assert.equal(hit(38, behind), Math.round((38 * k) / (k + 8)));
  assert.equal(hit(10, behind), 8);
  assert.equal(hit(1, behind), 1);
  // 방어력이 아무리 높아도 피해가 0 이 되지는 않고, 방어력이 K 와 같으면 절반이 된다.
  target.armor = 100000;
  assert.equal(hit(50, behind), 1);
  target.armor = k;
  assert.equal(hit(50, behind), 25);
});

test('정면 방어: 앞에서 온 피해만 줄이고, 행동 불가일 때는 막지 못한다', () => {
  const { target, hit, events, state, bus } = lone('dark_knight');
  assert.deepEqual([target.facingX, target.facingY], [0, 1]);
  const front = { fromX: target.x, fromY: target.y + 2 };
  const side = { fromX: target.x + 2, fromY: target.y };

  assert.equal(hit(20, front), 6, '20 × (1 - 0.6) 을 방어력 8 로 줄인 값');
  assert.equal(hit(20, side), 16, '옆은 막지 못한다(방어력만 적용)');
  assert.equal(hit(20), 16, '위치를 모르는 피해는 막지 못한다');
  assert.deepEqual(events(EVENTS.DAMAGE_DEALT).map((e) => e.blocked), [true, false, false]);

  applyStatus(state, bus, target, 'stun');
  assert.equal(hit(20, front), 16, '기절 중에는 막지 못한다');
});

test('무적인 동안에는 피해를 받지 않는다', () => {
  const { target, hit, state, events } = lone('zombie');
  target.invulnUntil = state.tick + 5;
  assert.equal(hit(50), 0);
  assert.equal(target.hp, 60);
  assert.equal(events(EVENTS.DAMAGE_DEALT).length, 0);
});

test('죽음: 체력 0, 행동·상태이상 정리, 죽인 쪽 기록, 이미 죽은 대상은 더 맞지 않는다', () => {
  const { target, hit, state, bus, step, events } = lone('zombie');
  applyStatus(state, bus, target, 'poison');
  assert.equal(hit(999, { sourceId: 42 }), 60);
  assert.equal(target.hp, 0);
  assert.equal(target.dead, true);
  assert.equal(target.killerId, 42);
  assert.deepEqual(target.statuses, {});
  assert.equal(hit(10), 0);

  step(1);
  assert.equal(state.entities.byId[target.id], undefined, '죽음 처리 뒤 목록에서 빠진다');
  assert.deepEqual(events(EVENTS.ENTITY_DIED).map((e) => [e.id, e.type, e.killerId]), [[target.id, 'zombie', 42]]);
});

test('heal 은 최대 체력을 넘지 않고 죽은 대상은 회복하지 않는다', () => {
  const { target, hit } = lone('zombie');
  hit(30);
  assert.equal(heal(target, 10), 10);
  assert.equal(heal(target, 100), 20);
  assert.equal(target.hp, target.maxHp);
  hit(999);
  assert.equal(heal(target, 10), 0);
});

test('플레이어에게 맞은 적은 깨어난다', () => {
  const a = createArena(openRoom(40, 8), { player: { x: 2.5, y: 4.5 } });
  const far = a.enemy('skeleton', { x: 12.5, y: 4.5 });
  a.step(sec(1));
  assert.equal(far.ai.mode, 'idle', '어그로 반경(7) 밖이면 눈치채지 못한다');
  dealDamage(a.state, a.bus, far, 1, { sourceId: a.player.id });
  a.step(1);
  assert.equal(far.ai.mode, 'combat');
});

// ── 보스 페이즈 ──────────────────────────────────────────────────────────────

test('보스: 큰 피해를 받아도 페이즈 경계에서 멈추고 다음 페이즈로 넘어간다', () => {
  const { target, hit, state, events } = lone('bone_warden');
  const floor = Math.ceil(target.maxHp * 0.5);

  assert.equal(hit(100000), target.maxHp - floor, '경계까지만 깎인다');
  assert.equal(target.hp, floor);
  assert.equal(target.dead, false);
  assert.equal(target.ai.phase, 1);
  const ticks = sec(BOSSES.bone_warden.transitionSec);
  assert.deepEqual(events(EVENTS.BOSS_PHASE_CHANGED), [
    { id: target.id, type: 'bone_warden', from: 0, to: 1, phases: 2, ticks, event: EVENTS.BOSS_PHASE_CHANGED, tick: state.tick },
  ]);
  assert.equal(target.invulnUntil, state.tick + ticks);
});

test('보스: 전환 중에는 무적이고, 걸려 있던 상태이상과 준비 중이던 행동이 풀린다', () => {
  const { target, hit, state, bus, step } = lone('bone_warden');
  applyStatus(state, bus, target, 'burn');
  applyStatus(state, bus, target, 'slow');
  target.action = { ability: 'cleave', phase: 'windup', until: state.tick + 30, dirX: 0, dirY: 1, targetX: 0, targetY: 0 };
  hit(100000);

  assert.deepEqual(target.statuses, {});
  assert.equal(target.action, null);
  assert.equal(hit(100), 0, '전환 중 무적');
  assert.equal(applyStatus(state, bus, target, 'burn'), false, '전환 중에는 상태이상도 걸리지 않는다');
  step(sec(1.5));
  assert.equal(hit(100), 88, '전환이 끝나면 다시 맞는다(방어력 4)');
});

test('보스: 마지막 페이즈에서만 죽는다 — 최종보스는 두 번의 전환을 모두 거친다', () => {
  const { target, hit, step, state, events } = lone('abyss_lord');
  const floors = BOSSES.abyss_lord.phases.map((p) => Math.ceil(target.maxHp * p.until));
  assert.deepEqual(floors, [462, 231, 0]);

  hit(100000);
  assert.equal(target.hp, 462);
  step(sec(2));
  hit(100000);
  assert.equal(target.hp, 231);
  assert.equal(target.dead, false);
  step(sec(2));
  hit(100000);
  assert.equal(target.dead, true);
  step(1);

  assert.deepEqual(events(EVENTS.BOSS_PHASE_CHANGED).map((e) => [e.from, e.to]), [[0, 1], [1, 2]]);
  assert.equal(events(EVENTS.ENTITY_DIED).length, 1);
  assert.equal(state.entities.byId[target.id], undefined);
});

test('보스: 지속 피해로도 페이즈를 건너뛰지 못하고, 경계에 닿으면 전환된다', () => {
  const { target, state, bus, step, events } = lone('cinder_drake');
  const floor = Math.ceil(target.maxHp * 0.5);
  target.hp = floor + 2;
  applyStatus(state, bus, target, 'poison', { stacks: 5 });
  step(sec(0.5));

  assert.equal(target.hp, floor);
  assert.equal(target.ai.phase, 1);
  assert.deepEqual(target.statuses, {}, '전환 때 독도 정화된다');
  assert.equal(events(EVENTS.BOSS_PHASE_CHANGED).length, 1);
  step(sec(3));
  assert.equal(target.hp, floor, '정화된 뒤에는 더 깎이지 않는다');
});

test('보스: 경계 바로 위에서 작은 피해를 여러 번 받아도 전환은 한 번만 일어난다', () => {
  const { target, hit, step, events } = lone('spore_mother');
  const floor = Math.ceil(target.maxHp * 0.5);
  target.hp = floor + 3;
  for (let i = 0; i < 10; i++) hit(1);
  assert.equal(target.hp, floor);
  assert.equal(events(EVENTS.BOSS_PHASE_CHANGED).length, 1);
  step(sec(2));
  hit(1);
  assert.equal(target.hp, floor - 1);
  assert.equal(target.ai.phase, 1);
  assert.equal(events(EVENTS.BOSS_PHASE_CHANGED).length, 1);
});
