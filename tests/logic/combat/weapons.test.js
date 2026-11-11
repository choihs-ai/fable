// 무기가 쓰는 효과: 꿰뚫기, 폭발, 광선, 탄 지우기, 넉백과 경직, 흩어짐.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FEEL } from '../../../data/feel.js';
import { WEAPONS, WEAPON_ORDER } from '../../../data/weapons.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { knockback } from '../../../src/logic/combat/damage.js';
import { spawnProjectile } from '../../../src/logic/combat/projectiles.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

const ROOM = openRoom(30, 14);
const arena = (options) => createArena(ROOM, { player: { x: 6.5, y: 7.5 }, ...options });
function dummy(a, x, y, { heavy = true } = {}) {
  const z = a.enemy('zombie', { x, y });
  z.maxHp = z.hp = 100000;
  z.speed = 0;
  if (heavy) z.mass = 1e9;
  return z;
}
function arm(a, first, second = null) {
  a.player.kit.weapons = [first, second];
  a.player.kit.slot = 0;
  a.player.kit.energy = a.player.kit.maxEnergy = 10000;
}
const hits = (a, target) => a.events(EVENTS.DAMAGE_DEALT).filter((e) => e.targetId === target.id);

test('모든 무기: 기본 공격과 대시 공격이 실제로 나가 적을 맞히고, 상태는 검증기를 통과한다', () => {
  for (const id of WEAPON_ORDER) {
    const a = arena();
    arm(a, id);
    const z = dummy(a, 8.0, 7.5);
    a.step(sec(1.5), { attack: true });
    assert.ok(hits(a, z).length >= 1, `${id}: 기본 공격이 맞지 않음`);
    assert.ok(a.events(EVENTS.WEAPON_USED).length >= 1, id);

    const b = arena({ player: { x: 4.5, y: 7.5 } });
    arm(b, id);
    const target = dummy(b, 8.6, 7.5);
    b.step(1, { moveX: 1, moveY: 0, dash: true });
    b.step(sec(1), { moveX: 0, moveY: 0, attack: true });
    assert.equal(b.events(EVENTS.WEAPON_USED)[0].dash, true, `${id}: 대시 공격`);
    assert.ok(hits(b, target).length >= 1, `${id}: 대시 공격이 맞지 않음`);
  }
});

test('꿰뚫기: 활의 화살은 한 명을 더 꿰뚫고, 저격총은 줄지어 선 적을 여럿 꿰뚫는다', () => {
  const a = arena();
  arm(a, 'bow');
  const row = [9.5, 11.5, 13.5].map((x) => dummy(a, x, 7.5));
  a.step(1, { attack: true });
  a.step(sec(1), { attack: false });
  assert.deepEqual(row.map((z) => hits(a, z).length), [1, 1, 0]);

  const b = arena();
  arm(b, 'sniper');
  const line = [9.5, 11.5, 13.5, 15.5, 17.5].map((x) => dummy(b, x, 7.5));
  b.step(1, { attack: true });
  b.step(sec(1), { attack: false });
  assert.deepEqual(line.map((z) => hits(b, z).length), [1, 1, 1, 1, 0]);
});

test('폭발: 로켓은 맞은 자리 둘레의 적을 함께 맞히고, 벽에 닿아도 터지며, 벽 너머는 맞히지 못한다', () => {
  const a = arena();
  arm(a, 'rocket');
  const target = dummy(a, 12.5, 7.5);
  const near = dummy(a, 13.5, 8.5);
  const far = dummy(a, 12.5, 12.5);
  a.step(1, { attack: true });
  a.step(sec(1.5), { attack: false });
  assert.equal(hits(a, target).length, 2, '직격 + 폭발');
  assert.equal(hits(a, near).length, 1);
  assert.equal(hits(a, far).length, 0);
  assert.equal(a.events(EVENTS.EXPLOSION).length, 1);

  // 벽에 닿아 터진다. 벽 옆의 적은 맞고, 벽 너머의 적은 맞지 않는다.
  const rows = openRoom(20, 9);
  rows[4] = '#...........#......#';
  const b = createArena(rows, { player: { x: 3.5, y: 4.5 } });
  arm(b, 'rocket');
  const beside = dummy(b, 11.5, 3.5);
  const behind = dummy(b, 13.5, 4.5);
  b.step(1, { attack: true, aimX: 1, aimY: 0 });
  b.step(sec(1.5), { attack: false, aimX: 0, aimY: 0 });
  assert.equal(b.events(EVENTS.EXPLOSION).length, 1);
  assert.equal(hits(b, beside).length, 1);
  assert.equal(hits(b, behind).length, 0);
});

test('광선: 레이저는 벽에 닿을 때까지 뻗어 닿는 적을 모두 맞히고 투사체를 만들지 않는다', () => {
  const a = arena();
  arm(a, 'laser');
  const one = dummy(a, 9.5, 7.5);
  const two = dummy(a, 12.5, 7.5);
  const off = dummy(a, 10.5, 9.5);
  const out = dummy(a, 6.5 + WEAPONS.laser.attack.effects[0].range + 2, 7.5);
  a.step(1, { attack: true, aimX: 1, aimY: 0 });
  assert.equal(a.state.projectiles.length, 0);
  assert.deepEqual([one, two, off, out].map((z) => hits(a, z).length), [1, 1, 0, 0]);
  const beam = a.events(EVENTS.BEAM_FIRED)[0];
  assert.ok(Math.abs(beam.x1 - (6.5 + WEAPONS.laser.attack.effects[0].range)) < 1e-6 && beam.y1 === 7.5);

  // 벽이 가로막으면 거기서 끊긴다.
  const rows = openRoom(20, 9);
  rows[4] = '#.......#..........#';
  const b = createArena(rows, { player: { x: 3.5, y: 4.5 } });
  arm(b, 'laser');
  const hidden = dummy(b, 10.5, 4.5);
  b.step(1, { attack: true, aimX: 1, aimY: 0 });
  assert.equal(hits(b, hidden).length, 0);
  assert.ok(b.events(EVENTS.BEAM_FIRED)[0].x1 < 8);
});

test('샷건은 부채꼴로 여러 발을 쏘고, 기관총은 조금씩 흩어진다(같은 시드면 같은 방향)', () => {
  const a = arena();
  arm(a, 'shotgun');
  dummy(a, 12.5, 7.5);
  a.step(1, { attack: true });
  const pellets = a.state.projectiles;
  assert.equal(pellets.length, WEAPONS.shotgun.attack.effects[0].spread.length);
  assert.ok(new Set(pellets.map((p) => p.vy.toFixed(4))).size === pellets.length, '방향이 모두 다르다');

  const shots = (seed) => {
    const b = arena({ seed });
    arm(b, 'smg');
    dummy(b, 20.5, 7.5);
    b.step(sec(1), { attack: true });
    return b.events(EVENTS.PROJECTILE_FIRED).map((e) => e.vy.toFixed(4));
  };
  const first = shots('jitter');
  assert.ok(new Set(first).size >= 3, '방향이 여러 가지');
  assert.deepEqual(shots('jitter'), first);
});

test('탄 지우기: 대검을 휘두르면 범위 안의 적 탄이 사라진다', () => {
  const a = arena();
  arm(a, 'greatsword');
  const shooter = dummy(a, 20.5, 7.5);
  const spec = { speed: 0.001, radius: 0.2, range: 30, damage: 10 };
  const inside = spawnProjectile(a.state, a.bus, shooter, spec, -1, 0, { x: 8.0, y: 7.5 });
  const behind = spawnProjectile(a.state, a.bus, shooter, spec, -1, 0, { x: 4.5, y: 7.5 });
  const far = spawnProjectile(a.state, a.bus, shooter, spec, -1, 0, { x: 12.5, y: 7.5 });
  a.step(sec(0.5), { attack: true, aimX: 1, aimY: 0 });
  const left = a.state.projectiles.map((p) => p.id);
  assert.ok(!left.includes(inside.id), '앞쪽 범위 안의 탄은 지워진다');
  assert.ok(left.includes(behind.id) && left.includes(far.id), '등 뒤와 범위 밖의 탄은 남는다');
  assert.equal(a.events(EVENTS.BULLETS_CLEARED)[0].count, 1);
});

test('넉백: 맞은 적이 밀려났다가 멈추고, 무거울수록 덜 밀리며, 벽을 뚫지 않는다', () => {
  const a = arena();
  arm(a, 'greatsword');
  const light = dummy(a, 8.0, 7.5, { heavy: false });
  a.step(sec(1.2), { attack: true, aimX: 1, aimY: 0 });
  const pushed = light.x - 8.0;
  assert.ok(pushed > 0.5, `밀려난 거리 ${pushed.toFixed(2)}`);
  a.step(sec(1), { attack: false });
  assert.equal(light.kbX, 0, '멈춘다');

  const b = arena();
  const z = dummy(b, 10.5, 7.5, { heavy: false });
  const boss = b.enemy('bone_warden', { x: 10.5, y: 10.5 });
  boss.speed = 0;
  const v1 = knockback(b.state, b.bus, z, 9.5, 7.5, 12);
  const v2 = knockback(b.state, b.bus, boss, 9.5, 10.5, 12);
  assert.ok(v2 < v1 / 5, '보스는 거의 밀리지 않는다');
  knockback(b.state, b.bus, z, 9.5, 7.5, 1e6);
  assert.ok(Math.hypot(z.kbX, z.kbY) <= FEEL.knockback.max + 1e-9, '속도에는 상한이 있다');
  b.step(sec(3));
  assert.ok(z.x < 29 && z.x > 10.5, '벽 앞에서 멈춘다');
  for (const actor of Object.values(b.state.entities.byId)) assert.ok(Number.isFinite(actor.x) && Number.isFinite(actor.y));
});

test('경직: 센 넉백은 준비 중이던 적의 공격을 끊고, 약한 넉백은 끊지 못한다', () => {
  for (const [weapon, interrupted] of [['greatsword', true], ['dagger', false]]) {
    const a = arena();
    arm(a, weapon);
    const skeleton = a.enemy('skeleton', { x: 7.6, y: 7.5 }, { alerted: true });
    skeleton.maxHp = skeleton.hp = 100000;
    a.player.maxHp = a.player.hp = 100000;
    // 해골이 공격을 준비하기 시작할 때까지 기다렸다가 때린다.
    for (let i = 0; i < sec(2) && !skeleton.action; i++) a.step(1);
    assert.equal(skeleton.action.phase, 'windup', weapon);
    a.step(sec(0.25), { attack: true, aimX: 1, aimY: 0 });
    assert.equal(a.events(EVENTS.ABILITY_INTERRUPTED).some((e) => e.actorId === skeleton.id), interrupted, weapon);
  }
});
