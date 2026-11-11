// 상태이상 규칙(data/statuses.js 머리말)을 하나씩 확인한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATUSES, STATUS_ORDER } from '../../../data/statuses.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE } from '../../../src/logic/core/state.js';
import { dealDamage } from '../../../src/logic/combat/damage.js';
import { applyStatus } from '../../../src/logic/combat/statuses.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

const ROOM = openRoom(20, 12);
/** 플레이어 혼자 있는 방. 상태이상을 플레이어에게 걸어 본다. */
function solo() {
  const a = createArena(ROOM, { player: { x: 10.5, y: 6.5 } });
  // 체력을 100 으로 맞춘다(캐릭터의 기본 체력에 테스트가 흔들리지 않도록).
  a.player.maxHp = a.player.hp = 100;
  return { ...a, p: a.player, apply: (id, opts) => applyStatus(a.state, a.bus, a.player, id, opts) };
}

test('상태이상 데이터: 모두 정의되어 있고 처리 순서에 빠짐이 없다', () => {
  assert.deepEqual([...STATUS_ORDER].sort(), Object.keys(STATUSES).sort());
  for (const id of ['poison', 'burn', 'bleed', 'slow', 'freeze', 'stun', 'warp']) assert.ok(STATUSES[id], id);
  for (const [id, def] of Object.entries(STATUSES)) {
    assert.ok(['intensity', 'refresh', 'none'].includes(def.stacking), `${id}.stacking`);
    assert.ok(def.duration > 0 && Number.isInteger(def.maxStacks) && def.maxStacks >= 1, id);
    if (def.stacking !== 'intensity') assert.equal(def.maxStacks, 1, `${id}: 중첩되지 않는 상태이상의 maxStacks`);
    if (def.damage) assert.ok(def.interval > 0 && Number.isInteger(def.damage), `${id} 지속 피해`);
    for (const other of def.removes ?? []) assert.ok(STATUSES[other], `${id}.removes ${other}`);
  }
});

// ── 독: 중첩(intensity) ──

test('독: interval 마다 중첩 수만큼 피해, 지속시간이 끝나면 풀린다', () => {
  const { p, apply, step, events } = solo();
  assert.equal(apply('poison'), true);
  assert.equal(p.statuses.poison.stacks, 1);

  step(sec(0.5) - 1);
  assert.equal(p.hp, 100, '첫 피해는 interval 뒤');
  step(1);
  assert.equal(p.hp, 99);
  step(sec(4) - sec(0.5));
  assert.equal(p.hp, 92, '4초 동안 0.5초마다 1씩 8번');
  assert.equal(p.statuses.poison, undefined);
  assert.deepEqual(events(EVENTS.STATUS_ENDED).map((e) => [e.status, e.reason]), [['poison', 'expired']]);
  step(sec(2));
  assert.equal(p.hp, 92, '풀린 뒤에는 더 깎이지 않는다');
});

test('독: 다시 걸리면 중첩이 늘고(최대 5) 지속시간이 갱신된다', () => {
  const { p, apply, state, step } = solo();
  apply('poison');
  step(sec(1));
  for (let i = 0; i < 3; i++) apply('poison');
  assert.equal(p.statuses.poison.stacks, 4);
  assert.equal(p.statuses.poison.until, state.tick + sec(4), '지속시간은 처음 길이로 갱신');
  apply('poison', { stacks: 2 });
  assert.equal(p.statuses.poison.stacks, 5);
  apply('poison', { stacks: 9 });
  assert.equal(p.statuses.poison.stacks, 5, '상한');

  const before = p.hp;
  step(sec(0.5));
  assert.equal(before - p.hp, 5, '피해는 중첩 수에 비례');
});

test('독: 계속 갱신해도 피해 주기는 초기화되지 않는다(피해를 미룰 수 없다)', () => {
  const { p, apply, step } = solo();
  apply('poison');
  // 0.5초 주기인데 0.25초마다 다시 건다.
  for (let i = 0; i < 8; i++) {
    step(sec(0.25));
    apply('poison');
  }
  // 2초 동안 0.5초마다 한 번씩, 그때의 중첩 수(2,4,5,5)만큼 깎였어야 한다.
  assert.equal(p.hp, 100 - (2 + 4 + 5 + 5));
});

// ── 화상: 갱신(refresh) ──

test('화상: 중첩되지 않고 지속시간만 긴 쪽으로 갱신된다', () => {
  const { p, apply, state, step } = solo();
  apply('burn');
  step(sec(1));
  assert.equal(apply('burn'), true);
  assert.equal(p.statuses.burn.stacks, 1);
  assert.equal(p.statuses.burn.until, state.tick + sec(3));
  // 더 짧은 지속시간으로 걸어도 남은 시간이 줄지 않는다.
  apply('burn', { duration: 0.5 });
  assert.equal(p.statuses.burn.until, state.tick + sec(3));

  const before = p.hp;
  step(sec(0.5));
  assert.equal(before - p.hp, 3);
});

// ── 출혈 ──

test('출혈: 중첩 최대 3, 움직이는 동안 피해가 두 배', () => {
  const still = solo();
  still.apply('bleed');
  still.step(sec(1));
  assert.equal(still.p.hp, 98);

  const moving = solo();
  moving.apply('bleed');
  moving.step(sec(1), { moveX: 1, moveY: 0 });
  assert.equal(moving.p.hp, 96);

  for (let i = 0; i < 5; i++) still.apply('bleed');
  assert.equal(still.p.statuses.bleed.stacks, 3);
});

// ── 둔화 ──

test('둔화: 이동 속도가 절반이 되고, 풀리면 돌아온다', () => {
  const normal = solo();
  normal.step(sec(1), { moveX: 1, moveY: 0 });
  const slowed = solo();
  slowed.apply('slow');
  slowed.step(sec(1), { moveX: 1, moveY: 0 });
  const a = normal.p.x - 10.5;
  const b = slowed.p.x - 10.5;
  assert.ok(Math.abs(b - a / 2) < 0.05, `보통 ${a.toFixed(2)}칸, 둔화 ${b.toFixed(2)}칸`);

  slowed.step(sec(2));
  assert.equal(slowed.p.statuses.slow, undefined);
  assert.equal(slowed.p.speedMul, 1);
});

// ── 빙결·기절: 행동 불가와 면역 시간 ──

for (const id of ['freeze', 'stun']) {
  test(`${STATUSES[id].name}: 움직이지 못하고, 걸려 있는 동안 다시 걸리지 않고, 풀린 뒤 면역 시간이 있다`, () => {
    const { p, apply, step, state } = solo();
    const def = STATUSES[id];
    assert.equal(apply(id), true);
    assert.equal(p.disabled, true, '걸린 즉시 행동 불가');
    assert.equal(apply(id), false, '걸려 있는 동안은 무시');
    const until = p.statuses[id].until;

    step(sec(def.duration) - 1, { moveX: 1, moveY: 0, attack: true });
    assert.ok(Math.abs(p.x - 10.5) < 1e-9, '움직이지 못한다');
    assert.equal(p.statuses[id].until, until, '다시 걸려고 해도 지속시간이 늘지 않는다');
    step(1, { moveX: 1, moveY: 0 });
    assert.equal(p.statuses[id], undefined);
    assert.equal(p.disabled, false);
    assert.ok(p.x > 10.5, '풀린 틱부터 움직인다');

    const freedAt = state.tick;
    assert.equal(apply(id), false, '면역 시간');
    step(sec(def.immunityAfter) - 1);
    assert.equal(apply(id), false, '면역 시간이 끝나기 직전');
    step(1);
    assert.equal(state.tick, freedAt + sec(def.immunityAfter));
    assert.equal(apply(id), true, '면역 시간이 끝나면 다시 걸린다');
  });
}

test('빙결과 기절은 면역 시간을 따로 센다', () => {
  const { p, apply, step } = solo();
  apply('stun');
  step(sec(1));
  assert.equal(apply('stun'), false);
  assert.equal(apply('freeze'), true);
  assert.equal(p.disabled, true);
});

test('기절은 준비 중이던 행동을 끊는다', () => {
  const a = createArena(ROOM, { player: { x: 10.5, y: 6.5 } });
  a.player.maxHp = a.player.hp = 100000;
  const zombie = a.enemy('zombie', { x: 11.5, y: 6.5 }, { alerted: true });
  for (let i = 0; i < 120 && !(zombie.action && zombie.action.phase === 'windup'); i++) a.step(1);
  assert.equal(zombie.action?.phase, 'windup', '좀비가 공격을 준비해야 함');

  applyStatus(a.state, a.bus, zombie, 'stun');
  assert.equal(zombie.action, null);
  assert.equal(a.events(EVENTS.ABILITY_INTERRUPTED).length, 1);
  const hp = a.player.hp;
  a.step(sec(0.9));
  assert.equal(a.player.hp, hp, '끊긴 공격은 발동하지 않는다');
});

// ── 상호작용 ──

test('화상은 빙결·둔화를 풀고, 빙결은 화상을 푼다', () => {
  const frozen = solo();
  frozen.apply('freeze');
  frozen.apply('slow');
  assert.equal(frozen.apply('burn'), true);
  assert.equal(frozen.p.statuses.freeze, undefined);
  assert.equal(frozen.p.statuses.slow, undefined);
  assert.ok(frozen.p.statuses.burn);
  assert.equal(frozen.apply('freeze'), false, '녹은 뒤에도 빙결 면역 시간이 적용된다');
  frozen.step(1);
  assert.equal(frozen.p.disabled, false);

  const burning = solo();
  burning.apply('burn');
  assert.equal(burning.apply('freeze'), true);
  assert.equal(burning.p.statuses.burn, undefined);
  assert.ok(burning.p.statuses.freeze);
});

test('서로 다른 상태이상은 함께 걸린다', () => {
  const { p, apply, step } = solo();
  for (const id of ['poison', 'bleed', 'slow', 'stun']) assert.equal(apply(id), true, id);
  step(sec(1));
  assert.equal(p.hp, 100 - 2 - 2, '독 1×2회 + 출혈 2×1회');
});

// ── 면역·저항 ──

test('면역인 대상에게는 걸리지 않고, 저항은 지속시간을 줄인다', () => {
  const a = createArena(openRoom(30, 12));
  const skeleton = a.enemy('skeleton', { x: 3.5, y: 3.5 });
  const golem = a.enemy('stone_golem', { x: 10.5, y: 3.5 });
  const warden = a.enemy('bone_warden', { x: 20.5, y: 6.5 });
  const on = (target, id, opts) => applyStatus(a.state, a.bus, target, id, opts);

  assert.equal(on(skeleton, 'poison'), false);
  assert.equal(on(skeleton, 'bleed'), false);
  assert.equal(on(skeleton, 'burn'), true);
  assert.equal(on(golem, 'stun'), true);
  assert.equal(golem.statuses.stun.until - a.state.tick, sec(0.5), '골렘은 기절 저항 0.5');
  assert.equal(on(warden, 'freeze'), false, '보스는 빙결 면역');
  assert.equal(on(warden, 'stun', { duration: 1 }), true);
  assert.equal(warden.statuses.stun.until - a.state.tick, sec(0.4));
  assert.equal(a.events(EVENTS.STATUS_APPLIED).length, 3);
});

test('무적이거나 죽은 대상에게는 걸리지 않는다', () => {
  const { p, apply, state } = solo();
  p.invulnUntil = state.tick + 10;
  assert.equal(apply('poison'), false);
  p.invulnUntil = 0;
  p.dead = true;
  assert.equal(apply('poison'), false);
});

test('알 수 없는 상태이상은 예외', () => {
  const { apply } = solo();
  assert.throws(() => apply('curse'), RangeError);
});

// ── 지속 피해의 성질 ──

test('지속 피해는 방어력과 정면 방어를 무시한다', () => {
  const a = createArena(openRoom(12, 8));
  const knight = a.enemy('dark_knight', { x: 5.5, y: 4.5 });
  applyStatus(a.state, a.bus, knight, 'burn');
  a.step(sec(0.5));
  assert.equal(knight.maxHp - knight.hp, 3, '방어력 2 가 적용되지 않는다');
  const dot = a.events(EVENTS.DAMAGE_DEALT);
  assert.deepEqual(dot.map((e) => [e.kind, e.amount, e.blocked]), [['dot', 3, false]]);
});

test('지속 피해로 죽을 수 있고, 죽으면 상태이상이 모두 지워진다', () => {
  const { p, apply, step, state, events } = solo();
  p.hp = 2;
  apply('poison', { stacks: 3 });
  apply('slow');
  step(sec(0.5));
  assert.equal(p.dead, true);
  assert.equal(p.hp, 0);
  assert.deepEqual(p.statuses, {});
  assert.equal(state.phase, PHASE.GAME_OVER);
  assert.equal(events(EVENTS.ENTITY_DIED).length, 1);
  const tick = state.tick;
  step(10);
  assert.equal(state.tick, tick, '게임 오버 뒤에는 틱이 진행되지 않는다');
});

test('지속 피해의 가해자가 기록된다', () => {
  const { p, state, bus, step, events } = solo();
  applyStatus(state, bus, p, 'poison', { sourceId: 77 });
  step(sec(0.5));
  assert.equal(events(EVENTS.DAMAGE_DEALT)[0].sourceId, 77);
  dealDamage(state, bus, p, 1000, { sourceId: 77 });
  assert.equal(p.killerId, 77);
});
