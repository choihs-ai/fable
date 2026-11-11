// 축복의 효과를 하나씩 확인한다. 수치는 data/boons.js.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BOONS } from '../../../data/boons.js';
import { PLAYER } from '../../../data/player.js';
import { WEAPONS } from '../../../data/weapons.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE } from '../../../src/logic/core/state.js';
import { dealDamage } from '../../../src/logic/combat/damage.js';
import { applyHit } from '../../../src/logic/combat/hit.js';
import { spawnProjectile } from '../../../src/logic/combat/projectiles.js';
import { applyStatus } from '../../../src/logic/combat/statuses.js';
import { refreshPlayerStats } from '../../../src/logic/entities/stats.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

const ROOM = openRoom(30, 14);
/** 축복을 가진 플레이어. 치명타는 꺼 둔다(피해량을 정확히 비교하려고). */
function arena(boons, options = {}) {
  const a = createArena(ROOM, { player: { x: 6.5, y: 7.5 }, ...options });
  a.state.run.boons.push(...boons);
  refreshPlayerStats(a.state);
  if (!boons.includes('conduct')) a.player.critChance = 0;
  a.player.kit.energy = a.player.kit.maxEnergy = 10000;
  return a;
}
function dummy(a, x, y, hp = 100000) {
  const z = a.enemy('zombie', { x, y });
  z.maxHp = z.hp = hp;
  z.speed = 0;
  z.mass = 1e9;
  return z;
}
function arm(a, first, second = null) {
  a.player.kit.weapons = [first, second];
  a.player.kit.slot = 0;
}
const hits = (a, target, proc) => a.events(EVENTS.DAMAGE_DEALT).filter((e) => e.targetId === target.id && (proc === undefined || e.proc === proc));
const DASH_TICKS = Math.max(1, Math.round(PLAYER.dash.duration * 60));
/** 플레이어의 공격 한 번이 target 에 맞은 것으로 친다. */
const strike = (a, target, damage = 10) => applyHit(a.state, a.bus, target, { damage }, a.player.id, a.player.x, a.player.y, true);

// ── 불 ──

test('불길 대시: 대시로 지나간 자리에 불길이 남아 적을 태운다', () => {
  const a = arena(['ember_trail']);
  const z = dummy(a, 8.0, 7.5);
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 2, { moveX: 0, moveY: 0 });
  const fires = a.state.hazards.filter((h) => h.faction === 'player');
  assert.ok(fires.length >= 3, `불길 ${fires.length}개`);
  assert.ok(fires.every((h) => h.y === 7.5 && h.x > 6.4 && h.x < 10), '지나간 길 위');
  a.step(sec(1.5));
  assert.ok(hits(a, z).length >= 2, '불길이 여러 번 태운다');
  assert.ok(z.statuses.burn, '화상');
  a.step(sec(3));
  assert.equal(a.state.hazards.length, 0, '불길은 사라진다');
});

test('점화탄: 공격이 맞으면 일정 확률로 화상을 건다', () => {
  const a = arena(['ignite']);
  const z = dummy(a, 8.0, 7.5);
  let burned = 0;
  for (let i = 0; i < 200; i++) {
    z.statuses = {};
    strike(a, z, 1);
    if (z.statuses.burn) burned++;
  }
  assert.ok(Math.abs(burned / 200 - BOONS.ignite.chance) < 0.12, `화상 ${burned}/200`);
});

test('연쇄 폭발: 처치한 적이 터져 둘레의 적을 다치게 하고, 그 폭발로 죽은 적도 다시 터진다', () => {
  const a = arena(['blast_kill']);
  const first = dummy(a, 8.0, 7.5, 5);
  const second = dummy(a, 9.5, 7.5, 10);
  const third = dummy(a, 11.0, 7.5, 100000);
  const far = dummy(a, 20.5, 7.5, 100000);
  strike(a, first, 50);
  a.step(1);
  assert.equal(first.dead && second.dead, true, '폭발이 옆의 적을 죽였다');
  assert.equal(hits(a, third, 'blast').length, 1, '두 번째 폭발이 세 번째 적에게 닿았다');
  assert.equal(hits(a, far).length, 0);
  assert.equal(a.events(EVENTS.EXPLOSION).filter((e) => e.proc === 'blast').length, 2);
  assert.equal(a.state.run.kills, 2);
});

test('번지는 불: 화상에 걸린 적이 죽으면 주변 적에게 화상이 번진다', () => {
  const a = arena(['wildfire']);
  const victim = dummy(a, 8.0, 7.5, 5);
  const near = dummy(a, 9.5, 7.5);
  const far = dummy(a, 8.0 + BOONS.wildfire.radius + 2, 7.5);
  applyStatus(a.state, a.bus, victim, 'burn', { sourceId: a.player.id });
  strike(a, victim, 50);
  a.step(1);
  assert.ok(near.statuses.burn);
  assert.equal(far.statuses.burn, undefined);

  // 화상이 없던 적이 죽으면 번지지 않는다.
  const b = arena(['wildfire']);
  const plain = dummy(b, 8.0, 7.5, 5);
  const other = dummy(b, 9.5, 7.5);
  strike(b, plain, 50);
  b.step(1);
  assert.equal(other.statuses.burn, undefined);
});

// ── 번개 ──

test('번개 연쇄: 맞은 적에게서 가까운 적 둘에게 절반의 피해가 튄다(다시 튀지는 않는다)', () => {
  const a = arena(['chain']);
  const target = dummy(a, 8.0, 7.5);
  const near = [dummy(a, 9.5, 7.5), dummy(a, 8.0, 9.5), dummy(a, 10.5, 9.0)];
  const far = dummy(a, 8.0 + BOONS.chain.range + 1.5, 7.5);
  strike(a, target, 20);
  assert.equal(hits(a, target).length, 1);
  assert.deepEqual(near.map((z) => hits(a, z, 'bolt').length), [1, 1, 0], '가까운 둘에게만');
  assert.equal(hits(a, near[0], 'bolt')[0].amount, 20 * BOONS.chain.ratio);
  assert.equal(hits(a, far).length, 0);
  assert.equal(a.events(EVENTS.CHAIN_LIGHTNING)[0].points.length, 3);
});

test('정전기 대시: 대시로 통과한 적이 피해를 입고 기절한다', () => {
  const a = arena(['static_dash']);
  const z = dummy(a, 8.0, 7.5);
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 1, { moveX: 0, moveY: 0 });
  assert.equal(hits(a, z).length, 1);
  assert.equal(hits(a, z)[0].amount, BOONS.static_dash.damage);
  assert.ok(z.statuses.stun);
});

test('과충전: 여덟 번째로 맞힌 공격마다 벼락이 떨어진다', () => {
  const a = arena(['overcharge']);
  const z = dummy(a, 8.0, 7.5);
  const beside = dummy(a, 9.0, 7.5);
  for (let i = 0; i < BOONS.overcharge.every - 1; i++) strike(a, z, 1);
  assert.equal(hits(a, z, 'bolt').length, 0);
  strike(a, z, 1);
  assert.equal(hits(a, z, 'bolt').length, 1);
  assert.equal(hits(a, z, 'bolt')[0].amount, BOONS.overcharge.damage);
  assert.equal(hits(a, beside, 'bolt').length, 1, '둘레의 적도 맞는다');
  for (let i = 0; i < BOONS.overcharge.every; i++) strike(a, z, 1);
  assert.equal(hits(a, z, 'bolt').length, 2);
});

test('전도: 치명타 확률이 오르고, 치명타가 적을 기절시킨다', () => {
  const a = arena(['conduct']);
  assert.ok(Math.abs(a.player.critChance - (PLAYER.critChance + BOONS.conduct.critChance)) < 1e-9);
  const z = dummy(a, 8.0, 7.5);
  a.player.critChance = 1;
  strike(a, z);
  assert.equal(hits(a, z)[0].crit, true);
  assert.ok(z.statuses.stun);
});

// ── 얼음 ──

test('서리탄: 공격이 맞으면 일정 확률로 적이 느려진다', () => {
  const a = arena(['frost_shot']);
  const z = dummy(a, 8.0, 7.5);
  let slowed = 0;
  for (let i = 0; i < 200; i++) {
    z.statuses = {};
    strike(a, z, 1);
    if (z.statuses.slow) slowed++;
  }
  assert.ok(Math.abs(slowed / 200 - BOONS.frost_shot.chance) < 0.12, `둔화 ${slowed}/200`);
});

test('빙결 대시: 대시가 끝나는 자리에서 주변 적이 얼어붙는다', () => {
  const a = arena(['frost_nova']);
  const landing = 6.5 + (PLAYER.dash.speed * DASH_TICKS) / 60;
  const near = dummy(a, landing + 1.2, 8.0);
  const far = dummy(a, landing + BOONS.frost_nova.radius + 2, 7.5);
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 2, { moveX: 0, moveY: 0 });
  assert.ok(near.statuses.freeze);
  assert.equal(far.statuses.freeze, undefined);
});

test('깨뜨리기: 느려지거나 얼어붙은 적에게 주는 피해가 는다', () => {
  const a = arena(['shatter']);
  const z = dummy(a, 8.0, 7.5);
  strike(a, z, 20);
  applyStatus(a.state, a.bus, z, 'slow');
  strike(a, z, 20);
  const amounts = hits(a, z).map((e) => e.amount);
  assert.deepEqual(amounts, [20, Math.round(20 * (1 + BOONS.shatter.bonus))]);
});

test('얼음 갑옷: 맞으면 주변 적이 얼어붙고, 재사용 대기 동안에는 다시 얼리지 않는다', () => {
  const a = arena(['ice_armor']);
  const z = dummy(a, 7.5, 7.5);
  const hurt = () => applyHit(a.state, a.bus, a.player, { damage: 1 }, z.id, z.x, z.y);
  hurt();
  assert.ok(z.statuses.freeze);
  a.step(sec(BOONS.ice_armor.cooldown) - 30);
  z.immuneUntil = {};
  hurt();
  assert.equal(z.statuses.freeze, undefined, '재사용 대기 중');
  a.step(60);
  z.immuneUntil = {};
  hurt();
  assert.ok(z.statuses.freeze);
});

// ── 무계열 ──

test('관통탄: 탄이 적 둘을 더 꿰뚫는다', () => {
  const a = arena(['pierce']);
  arm(a, 'pistol');
  const row = [9.5, 11.5, 13.5, 15.5].map((x) => dummy(a, x, 7.5));
  a.step(1, { attack: true });
  a.step(sec(1), { attack: false });
  assert.deepEqual(row.map((z) => hits(a, z).length), [1, 1, 1, 0]);
});

test('분열탄: 탄이 맞으면 두 갈래로 갈라지고, 갈라진 탄은 다시 갈라지지 않는다', () => {
  const a = arena(['split']);
  arm(a, 'pistol');
  const z = dummy(a, 9.5, 7.5);
  const side = dummy(a, 11.2, 8.7);
  a.step(1, { attack: true });
  a.step(sec(1), { attack: false });
  assert.equal(a.events(EVENTS.PROJECTILE_FIRED).length, 3, '원래 탄 + 갈라진 탄 둘');
  assert.equal(hits(a, z).length, 1, '갈라진 탄은 방금 맞힌 적을 다시 맞히지 않는다');
  assert.equal(hits(a, side).length, 1);
  assert.equal(hits(a, side)[0].amount, Math.round(WEAPONS.pistol.attack.effects[0].damage * BOONS.split.ratio));
  assert.equal(a.state.projectiles.length, 0);
});

test('도탄: 탄이 벽에 한 번 튕긴다', () => {
  const a = arena(['ricochet'], { player: { x: 24.5, y: 7.5 } });
  arm(a, 'pistol');
  const behind = dummy(a, 23.0, 7.5);
  // 오른쪽 벽으로 쏘면 튕겨 돌아와 뒤의 적을 맞힌다.
  a.step(1, { attack: true, aimX: 1, aimY: 0 });
  a.step(sec(1), { attack: false, aimX: 0, aimY: 0 });
  assert.equal(hits(a, behind).length, 1);
  assert.equal(a.state.projectiles.length, 0, '두 번째 벽에서는 사라진다');
});

test('궁지: 체력이 낮을수록 주는 피해가 는다', () => {
  const a = arena(['desperado']);
  const z = dummy(a, 8.0, 7.5);
  strike(a, z, 100);
  a.player.hp = Math.round(a.player.maxHp / 2);
  strike(a, z, 100);
  a.player.hp = 1;
  strike(a, z, 100);
  const amounts = hits(a, z).map((e) => e.amount);
  assert.equal(amounts[0], 100);
  assert.ok(Math.abs(amounts[1] - 140) <= 1, `절반일 때 ${amounts[1]}`);
  assert.ok(amounts[2] > 175 && amounts[2] <= 180, `거의 죽었을 때 ${amounts[2]}`);
});

test('잔상: 대시 직후의 첫 공격은 반드시 치명타이고, 한 번뿐이다', () => {
  const a = arena(['afterimage']);
  const z = dummy(a, 9.6, 7.5);
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 1, { moveX: 0, moveY: 0 });
  a.step(sec(0.8), { attack: true });
  const crits = hits(a, z).map((e) => e.crit);
  assert.equal(crits[0], true);
  assert.ok(crits.slice(1).every((c) => c === false));
});

test('흡혈·전지: 처치하면 체력을, 근접 공격이 맞으면 에너지를 얻는다', () => {
  const a = arena(['vampire', 'battery']);
  a.player.hp = 50;
  a.player.kit.energy = 10;
  const z = dummy(a, 8.0, 7.5, 5);
  strike(a, z, 50);
  a.step(1);
  assert.equal(a.player.hp, 50 + BOONS.vampire.heal);
  assert.equal(a.player.kit.energy, 10 + BOONS.battery.energy);
  // 원거리 공격으로는 에너지를 얻지 못한다.
  const other = dummy(a, 9.0, 7.5);
  applyHit(a.state, a.bus, other, { damage: 5 }, a.player.id, a.player.x, a.player.y, false);
  assert.equal(a.player.kit.energy, 10 + BOONS.battery.energy);
});

test('세 번째 숨·가속: 대시 충전이 하나 늘고, 충전이 빨라진다', () => {
  const base = arena([]);
  const a = arena(['third_dash', 'momentum']);
  assert.equal(a.player.kit.maxCharges, base.player.kit.maxCharges + 1);
  assert.equal(a.player.kit.charges, a.player.kit.maxCharges, '늘어난 만큼 바로 찬다');
  assert.equal(a.player.kit.rechargeTicks, Math.round(base.player.kit.rechargeTicks * BOONS.momentum.rechargeMul));
});

test('탄 가르기: 대시로 지나친 적의 탄이 사라지고 에너지를 얻는다', () => {
  const a = arena(['deflect']);
  a.player.kit.energy = 10;
  const shooter = dummy(a, 20.5, 7.5);
  spawnProjectile(a.state, a.bus, shooter, { speed: 0.001, radius: 0.2, range: 30, damage: 10 }, -1, 0, { x: 7.5, y: 7.5 });
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 1, { moveX: 0, moveY: 0 });
  assert.equal(a.state.projectiles.length, 0);
  assert.equal(a.player.kit.energy, 10 + BOONS.deflect.energy);
  assert.equal(hits(a, a.player).length, 0);
});

test('거인 사냥꾼: 정예와 보스에게만 피해가 는다', () => {
  const a = arena(['giant_slayer']);
  const normal = dummy(a, 8.0, 7.5);
  const elite = a.enemy('skeleton', { x: 8.0, y: 9.0 }, { elite: true });
  elite.maxHp = elite.hp = 100000;
  const boss = a.enemy('bone_warden', { x: 8.0, y: 5.0 });
  boss.armor = 0;
  strike(a, normal, 100);
  strike(a, elite, 100);
  strike(a, boss, 100);
  assert.equal(hits(a, normal)[0].amount, 100);
  assert.equal(hits(a, elite)[0].amount, Math.round(100 * (1 + BOONS.giant_slayer.bonus)));
  assert.equal(hits(a, boss)[0].amount, Math.round(100 * (1 + BOONS.giant_slayer.bonus)));
});

test('두 번째 바람: 쓰러질 때 한 번 되살아나고, 두 번째에는 죽는다', () => {
  const a = arena(['second_wind']);
  dealDamage(a.state, a.bus, a.player, 99999, { sourceId: null });
  a.step(1);
  assert.equal(a.player.dead, false);
  assert.equal(a.player.hp, Math.round((a.player.maxHp * BOONS.second_wind.hpPct) / 100));
  assert.equal(a.state.phase, PHASE.PLAYING);
  assert.equal(a.events(EVENTS.PLAYER_REVIVED).length, 1);
  assert.ok(a.player.invulnUntil > a.state.tick, '잠깐 무적');
  a.step(sec(BOONS.second_wind.invuln) + 2);
  dealDamage(a.state, a.bus, a.player, 99999, { sourceId: null });
  a.step(1);
  assert.equal(a.state.phase, PHASE.GAME_OVER);
});

test('유리 대포: 주는 피해가 늘고 최대 체력이 준다', () => {
  const base = arena([]);
  const a = arena(['glass_cannon']);
  assert.equal(a.player.maxHp, Math.round(base.player.maxHp * BOONS.glass_cannon.hpMul));
  assert.ok(a.player.hp <= a.player.maxHp);
  assert.ok(Math.abs(a.player.power - (base.player.power + BOONS.glass_cannon.power)) < 1e-9);
});

// ── 합성 ──

test('증기 폭발: 화상과 냉기가 한 적에게 겹치는 순간 폭발한다', () => {
  const a = arena(['ignite', 'frost_shot', 'steam']);
  const z = dummy(a, 8.0, 7.5);
  const beside = dummy(a, 9.5, 7.5);
  for (let i = 0; i < 40 && a.events(EVENTS.EXPLOSION).length === 0; i++) {
    strike(a, z, 1);
    a.step(1);
  }
  const boom = a.events(EVENTS.EXPLOSION).filter((e) => e.proc === 'steam');
  assert.equal(boom.length, 1);
  assert.equal(hits(a, beside, 'steam').length, 1, '둘레의 적도 맞는다');
  assert.equal(hits(a, beside, 'steam')[0].amount, BOONS.steam.damage);
});

test('플라스마: 번개가 화상을 걸고, 둘 더 멀리 튄다', () => {
  const a = arena(['chain', 'plasma']);
  const target = dummy(a, 8.0, 7.5);
  const near = [dummy(a, 9.0, 7.5), dummy(a, 8.0, 8.6), dummy(a, 9.0, 8.6), dummy(a, 8.0, 6.4), dummy(a, 9.0, 6.4)];
  strike(a, target, 20);
  const struck = near.filter((z) => hits(a, z, 'bolt').length === 1);
  assert.equal(struck.length, BOONS.chain.targets + BOONS.plasma.targets);
  assert.ok(struck.every((z) => z.statuses.burn), '번개에 맞은 적은 화상에 걸린다');
});

test('초전도: 느려지거나 얼어붙은 적은 번개에 두 배로 다치고 기절한다', () => {
  const a = arena(['chain', 'superconduct']);
  const target = dummy(a, 8.0, 7.5);
  const chilled = dummy(a, 9.0, 7.5);
  const plain = dummy(a, 8.0, 8.6);
  applyStatus(a.state, a.bus, chilled, 'slow');
  strike(a, target, 20);
  assert.equal(hits(a, chilled, 'bolt')[0].amount, 20 * BOONS.chain.ratio * BOONS.superconduct.mul);
  assert.ok(chilled.statuses.stun);
  assert.equal(hits(a, plain, 'bolt')[0].amount, 20 * BOONS.chain.ratio);
  assert.equal(plain.statuses.stun, undefined);
});

test('축복이 낸 피해는 다시 축복을 부르지 않는다(끝없이 되풀이되지 않는다)', () => {
  const a = arena(['chain', 'overcharge', 'blast_kill', 'ignite', 'frost_shot', 'steam', 'plasma', 'superconduct']);
  const crowd = [];
  for (let i = 0; i < 12; i++) crowd.push(dummy(a, 8.0 + (i % 4), 6.0 + Math.floor(i / 4), 30));
  for (let i = 0; i < 30; i++) {
    const alive = crowd.find((z) => !z.dead);
    if (!alive) break;
    strike(a, alive, 10);
    a.step(1);
  }
  assert.ok(crowd.every((z) => z.dead), '모두 잡았다');
  assert.equal(a.state.run.kills, 12);
});

test('데이터에 있는 축복은 모두 로직에서 쓰인다(이름만 있고 효과가 없는 축복이 없다)', () => {
  const dir = fileURLToPath(new URL('../../../src/logic/', import.meta.url));
  const source = ['combat/boons.js', 'combat/player.js', 'combat/projectiles.js', 'entities/stats.js']
    .map((file) => readFileSync(dir + file, 'utf8')).join('\n');
  for (const id of Object.keys(BOONS)) {
    assert.ok(source.includes(`'${id}'`) || source.includes(`BOONS.${id}`), `${id}: 로직 어디에서도 쓰이지 않는다`);
  }
});
