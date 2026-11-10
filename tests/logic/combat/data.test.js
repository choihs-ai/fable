// 전투 데이터(data/enemies.js, bosses.js, player.js)가 서로 맞물리는지 확인한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOSSES } from '../../../data/bosses.js';
import { ENEMIES } from '../../../data/enemies.js';
import { PLAYER } from '../../../data/player.js';
import { STATUSES } from '../../../data/statuses.js';
import { ZONES } from '../../../data/zones.js';
import { BEHAVIORS } from '../../../src/logic/combat/ai/behaviors.js';

const EFFECT_TYPES = ['arc', 'circle', 'projectile', 'hazard', 'dash', 'summon', 'teleport', 'die'];

function checkAbility(owner, id, ability) {
  const where = `${owner}.${id}`;
  for (const key of ['windup', 'recovery', 'cooldown', 'range', 'minRange']) {
    if (ability[key] !== undefined) assert.ok(typeof ability[key] === 'number' && ability[key] >= 0, `${where}.${key}`);
  }
  if (ability.range !== undefined && ability.minRange !== undefined) assert.ok(ability.minRange < ability.range, `${where}: minRange < range`);
  assert.ok(Array.isArray(ability.effects) && ability.effects.length > 0, `${where}.effects`);
  for (const effect of ability.effects) checkEffect(where, effect);
}

function checkEffect(where, effect) {
  assert.ok(EFFECT_TYPES.includes(effect.type), `${where}: 효과 종류 ${effect.type}`);
  if (effect.damage !== undefined) assert.ok(Number.isInteger(effect.damage) && effect.damage > 0, `${where}: 피해는 양의 정수`);
  if (effect.status) {
    assert.ok(STATUSES[effect.status.id], `${where}: 상태이상 ${effect.status.id}`);
    if (effect.status.chance !== undefined) assert.ok(effect.status.chance > 0 && effect.status.chance <= 1, `${where}: 확률`);
  }
  if (effect.type === 'arc') assert.ok(effect.range > 0 && effect.cosHalf >= -1 && effect.cosHalf <= 1, `${where}: 부채꼴`);
  if (effect.type === 'circle' || effect.type === 'hazard') assert.ok(effect.radius > 0, `${where}: 반지름`);
  if (effect.type === 'projectile') {
    assert.ok(effect.speed > 0 && effect.radius > 0 && effect.range > 0, `${where}: 투사체`);
    for (const [c, s] of effect.spread ?? []) {
      assert.ok(Math.abs(c * c + s * s - 1) < 2e-3, `${where}: 회전값 [${c}, ${s}] 의 길이가 1 이 아님`);
    }
  }
  if (effect.type === 'dash') assert.ok(effect.speed > 0 && effect.distance > 0, `${where}: 돌진`);
  if (effect.type === 'summon') {
    assert.ok(ENEMIES[effect.enemy], `${where}: 소환 대상 ${effect.enemy}`);
    assert.ok(Number.isInteger(effect.count) && effect.count > 0, `${where}: 소환 수`);
  }
  if (effect.type === 'teleport') assert.ok(effect.min >= 0 && effect.max > effect.min, `${where}: 순간이동 거리`);
}

function checkActor(id, def) {
  assert.ok(typeof def.name === 'string' && def.name.length > 0, `${id}.name`);
  assert.ok(Number.isInteger(def.hp) && def.hp > 0, `${id}.hp`);
  assert.ok(def.speed > 0, `${id}.speed`);
  assert.ok(def.radius > 0, `${id}.radius`);
  for (const status of def.immune ?? []) assert.ok(STATUSES[status], `${id}.immune ${status}`);
  for (const [status, value] of Object.entries(def.statusResist ?? {})) {
    assert.ok(STATUSES[status] && value >= 0 && value <= 1, `${id}.statusResist.${status}`);
  }
  for (const [abilityId, ability] of Object.entries(def.abilities)) checkAbility(id, abilityId, ability);
}

test('구역 데이터가 가리키는 적과 보스가 모두 정의되어 있다', () => {
  for (const zone of ZONES) {
    for (const enemy of zone.enemies) assert.ok(ENEMIES[enemy.id], `${zone.id}: 적 ${enemy.id}`);
    if (zone.boss) assert.ok(BOSSES[zone.boss.id], `${zone.id}: 보스 ${zone.boss.id}`);
  }
  assert.equal(Object.keys(ENEMIES).filter((id) => BOSSES[id]).length, 0, '적과 보스의 id 는 겹치지 않는다');
});

test('적은 8종 이상이고, 서로 다른 행동 방식이 8가지 이상이다', () => {
  const kinds = new Set(Object.values(ENEMIES).map((e) => e.ai));
  assert.ok(Object.keys(ENEMIES).length >= 8);
  assert.ok(kinds.size >= 8, `행동 방식 ${kinds.size}가지: ${[...kinds]}`);
  for (const required of ['melee', 'ranged', 'charger', 'summoner', 'skirmisher', 'exploder', 'tank', 'teleporter']) {
    assert.ok(kinds.has(required), `${required} 방식의 적이 없음`);
  }
  for (const kind of kinds) assert.equal(typeof BEHAVIORS[kind], 'function', `행동 함수 ${kind}`);
});

test('적 데이터: 수치가 유효하고, 행동 방식이 쓰는 기술이 모두 있다', () => {
  for (const [id, def] of Object.entries(ENEMIES)) {
    checkActor(id, def);
    assert.ok(def.radius < 0.5, `${id}: 일반 적의 반지름은 0.5 미만(한 칸 폭 복도를 지나야 한다)`);
    for (const [key, value] of Object.entries(def.aiParams)) {
      if (typeof value === 'string') assert.ok(def.abilities[value], `${id}.aiParams.${key} → 기술 "${value}" 없음`);
    }
    for (const effect of def.onDeath ?? []) checkEffect(`${id}.onDeath`, effect);
    if (def.block) assert.ok(def.block.factor > 0 && def.block.factor < 1 && def.block.cosHalf > -1 && def.block.cosHalf < 1, `${id}.block`);
  }
});

test('행동 방식별 필수 항목', () => {
  const need = {
    melee: ['attack'], ranged: ['attack', 'min', 'max'], charger: ['charge', 'melee'], summoner: ['summon', 'attack', 'keep', 'flee'],
    skirmisher: ['attack', 'retreatSec', 'retreatDist', 'fleeHp', 'fleeSec'], exploder: ['attack'], tank: ['bash', 'slam', 'turnRate'],
    teleporter: ['blink', 'attack', 'near', 'blinkEvery'], ambusher: ['leap', 'bite'], swooper: ['dive', 'melee', 'orbit'],
  };
  for (const [id, def] of Object.entries(ENEMIES)) {
    for (const key of need[def.ai]) assert.ok(def.aiParams[key] !== undefined, `${id}.aiParams.${key}`);
  }
});

test('거리 구간에 빈틈이 없다: 가까이 붙었을 때 쓸 기술이 반드시 있다', () => {
  for (const [id, def] of Object.entries(ENEMIES)) {
    const p = def.aiParams;
    if (def.ai === 'swooper') {
      // 강습의 최소 거리보다 가까우면 근접 공격이 닿아야 한다(그 사이 거리에서 아무것도 못 하는 구간이 없어야 한다).
      assert.ok(def.abilities[p.melee].range >= def.abilities[p.dive].minRange, `${id}: 근접 사거리 < 강습 최소 거리`);
    }
    if (def.ai === 'charger') assert.ok(def.abilities[p.melee].range <= def.abilities[p.charge].minRange, `${id}: 돌진 최소 거리 안에서는 근접`);
    if (def.ai === 'ambusher') assert.ok(def.abilities[p.bite].range <= def.abilities[p.leap].minRange, `${id}`);
    if (def.ai === 'ranged') assert.ok(p.min < p.max && def.abilities[p.attack].range >= p.max, `${id}: 유지 거리에서 쏠 수 있어야 한다`);
    if (def.ai === 'summoner') assert.ok(p.flee < p.keep && def.abilities[p.attack].range >= p.keep, `${id}`);
    if (def.ai === 'exploder') assert.ok(def.abilities[p.attack].effects.some((e) => e.type === 'die'), `${id}: 자폭 기술은 스스로 죽어야 한다`);
    // 근접 부채꼴은 "쓰는 거리"보다 조금 더 멀리 닿아야 헛치지 않는다.
    for (const [abilityId, ability] of Object.entries(def.abilities)) {
      const arc = ability.effects.find((e) => e.type === 'arc');
      if (arc && ability.range !== undefined) assert.ok(arc.range >= ability.range, `${id}.${abilityId}: 닿는 거리 < 쓰는 거리`);
    }
  }
});

test('보스: 중간보스 3종과 최종보스 1종, 최종보스는 페이즈가 2개 이상', () => {
  const mids = ZONES.filter((z) => z.boss?.kind === 'mid').map((z) => z.boss.id);
  const finals = ZONES.filter((z) => z.boss?.kind === 'final').map((z) => z.boss.id);
  assert.equal(mids.length, 3);
  assert.equal(finals.length, 1);
  assert.equal(new Set([...mids, ...finals]).size, 4);
  assert.deepEqual(Object.keys(BOSSES).sort(), [...mids, ...finals].sort());
  assert.ok(BOSSES[finals[0]].phases.length >= 2);
});

test('보스 데이터: 페이즈 경계가 내려가며 0 으로 끝나고, 패턴이 가리키는 기술이 모두 있다', () => {
  for (const [id, def] of Object.entries(BOSSES)) {
    checkActor(id, def);
    assert.ok(def.transitionSec > 0, `${id}.transitionSec`);
    assert.ok(def.phases.length >= 1);
    let previous = 1;
    def.phases.forEach((phase, i) => {
      assert.ok(phase.until < previous && phase.until >= 0, `${id} 페이즈 ${i}: until ${phase.until}`);
      previous = phase.until;
      assert.ok(['chase', 'keepAway'].includes(phase.move), `${id} 페이즈 ${i}: move`);
      if (phase.move === 'chase') assert.ok(phase.keepDist > 0, `${id} 페이즈 ${i}: keepDist`);
      else assert.ok(phase.band[0] < phase.band[1], `${id} 페이즈 ${i}: band`);
      assert.ok(phase.pauseSec >= 0);
      assert.ok(phase.patterns.length >= 2, `${id} 페이즈 ${i}: 패턴 2개 이상`);
      for (const pattern of phase.patterns) {
        assert.ok(def.abilities[pattern.ability], `${id} 페이즈 ${i}: 기술 "${pattern.ability}" 없음`);
        assert.ok(pattern.weight > 0);
      }
      // 어떤 거리에서든 쓸 수 있는 패턴이 하나는 있어야 한다(거리 조건 때문에 아무것도 못 하는 구간이 없도록).
      for (const d of [0.5, 1.5, 2.5, 3.5, 5, 8, 12]) {
        assert.ok(phase.patterns.some((pt) => d >= (pt.minDist ?? 0) && d <= (pt.maxDist ?? Infinity)), `${id} 페이즈 ${i}: 거리 ${d} 에서 쓸 패턴이 없음`);
      }
    });
    assert.equal(def.phases.at(-1).until, 0, `${id}: 마지막 페이즈는 0 에서 끝난다`);
    const used = new Set(def.phases.flatMap((p) => p.patterns.map((pt) => pt.ability)));
    for (const abilityId of Object.keys(def.abilities)) assert.ok(used.has(abilityId), `${id}: 기술 "${abilityId}" 를 쓰는 페이즈가 없음`);
  }
});

test('보스마다 고유한 패턴 구성을 가진다', () => {
  const sets = Object.values(BOSSES).map((def) => Object.keys(def.abilities).sort().join(','));
  assert.equal(new Set(sets).size, sets.length);
  // 중간보스끼리는 기술 이름이 거의 겹치지 않는다(같은 기술의 수치만 바꾼 복제가 아니다).
  const mids = ZONES.filter((z) => z.boss?.kind === 'mid').map((z) => new Set(Object.keys(BOSSES[z.boss.id].abilities)));
  for (let i = 0; i < mids.length; i++) {
    for (let j = i + 1; j < mids.length; j++) {
      const shared = [...mids[i]].filter((x) => mids[j].has(x));
      assert.ok(shared.length <= 1, `중간보스 ${i}·${j} 가 공유하는 기술: ${shared}`);
    }
  }
});

test('플레이어 데이터', () => {
  checkActor('player', { ...PLAYER, name: '플레이어' });
  assert.ok(PLAYER.radius < 0.5);
  assert.ok(PLAYER.dodge.speed > PLAYER.speed && PLAYER.dodge.invuln >= PLAYER.dodge.duration && PLAYER.dodge.cooldown > PLAYER.dodge.invuln);
  assert.ok(PLAYER.abilities[PLAYER.attack]);
  for (const id of PLAYER.skills) assert.ok(PLAYER.abilities[id], id);
});
