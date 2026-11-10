// 진행 시뮬레이터: 전투 없이 1층부터 마지막 층까지 "모든 적을 잡고, 모든 것을 줍고, 상점·제단을 쓰고,
// 레벨업 선택을 하는" 런을 실제 로직(logic/commands.js 등)으로 돌린다.
// 용도 ① 층별 기대 전투력 표의 재료  ② 아이템 시스템 전체의 통합 검사(매 단계 불변식 확인).
//
// 정책(자동 조작):
//   - 장비: 점수가 오르는 것만 낀다. 상점에서는 남는 것을 팔고, 점수가 오르는 장비를 금화가 되는 대로 산다.
//   - 가방이 차면 가장 싼 것부터 버린다.
//   - 레벨업·제단: 무작위로 고른다(특정 빌드에 치우치지 않은 평균을 보기 위해).

import { BOSSES } from '../../data/bosses.js';
import { COMBAT } from '../../data/combat.js';
import { DIFFICULTY } from '../../data/difficulty.js';
import { ENEMIES } from '../../data/enemies.js';
import { PLAYER } from '../../data/player.js';
import { WORLD } from '../../data/world.js';
import { ZONES } from '../../data/zones.js';
import { processDeaths } from '../../src/logic/combat/deaths.js';
import { collectDrops } from '../../src/logic/combat/loot.js';
import { acceptAltar, buyItem, chooseUpgrade, compareItem, discardItem, equipItem, sellItem } from '../../src/logic/commands.js';
import { Rng } from '../../src/logic/core/prng.js';
import { PHASE } from '../../src/logic/core/state.js';
import { allActors, getPlayer } from '../../src/logic/entities/actors.js';
import { canAccept } from '../../src/logic/items/altar.js';
import { sellPrice } from '../../src/logic/items/equipment.js';
import { compareEquipment } from '../../src/logic/items/stats.js';
import { createGame, enterFloor, setPhase } from '../../src/logic/game.js';
import { TOTAL_FLOORS } from '../../src/logic/world/floors.js';
import { checkChoice, checkState } from './item-checks.js';

// ── 전투력 지표 ──────────────────────────────────────────────────────────────

/** 플레이어 기술을 재사용 대기마다 쓴다고 볼 때의 기본 초당 피해(능력치 적용 전). */
export const BASE_DPS = [PLAYER.attack, ...PLAYER.skills].reduce((sum, id) => {
  const ability = PLAYER.abilities[id];
  const damage = ability.effects.reduce((s, e) => s + (e.damage ?? 0), 0);
  return sum + damage / ability.cooldown;
}, 0);

/** 능력치에서 구한 플레이어 초당 피해: 공격력 × 치명타 기대값 ÷ (1 - 재사용 대기 감소). */
export function playerDps(sheet) {
  const crit = 1 + (sheet.critChance / 100) * (0.5 + sheet.critDamage / 100);
  return (BASE_DPS * (1 + sheet.power / 100) * crit) / (1 - sheet.haste / 100);
}

/** 적 하나의 주력 기술: 한 번에 주는 피해와, 그것만 되풀이할 때의 초당 피해. */
function threatOf(def) {
  let best = { hit: 0, dps: 0 };
  for (const ability of Object.values(def.abilities)) {
    const hit = ability.effects.reduce((s, e) => s + (e.damage ?? 0), 0);
    if (hit === 0) continue;
    // 자폭은 한 번뿐이므로 한 번의 교전(약 5초)에 한 번 터지는 것으로 본다.
    const once = ability.effects.some((e) => e.type === 'die');
    const cycle = once ? 5 : (ability.windup ?? 0) + Math.max(ability.cooldown ?? 0, ability.recovery ?? 0);
    const dps = hit / Math.max(cycle, 0.2);
    if (dps > best.dps) best = { hit, dps };
  }
  return best;
}

function scaling(floor) {
  const per = WORLD.floorsPerZone;
  const zone = DIFFICULTY.zones[Math.floor((floor - 1) / per)];
  const t = ((floor - 1) % per) / (per - 1);
  return {
    hp: zone.hp[0] + (zone.hp[1] - zone.hp[0]) * t,
    damage: zone.damage[0] + (zone.damage[1] - zone.damage[0]) * t,
    boss: zone.boss ?? { hp: 1, damage: 1 },
  };
}

/**
 * 그 층 적의 강도(데이터에서 계산). 일반 층은 적 풀의 가중 평균, 보스층은 보스.
 * @returns {{ boss:boolean, hp:number, dps:number, hit:number, count:number }}
 */
export function enemyStrength(floor) {
  const per = WORLD.floorsPerZone;
  const zone = ZONES[Math.floor((floor - 1) / per)];
  const floorInZone = ((floor - 1) % per) + 1;
  const mul = scaling(floor);
  if (floorInZone === per && zone.boss) {
    const def = BOSSES[zone.boss.id];
    // 보스는 여러 패턴을 번갈아 쓰므로 패턴들의 평균으로 본다.
    const patterns = Object.values(def.abilities)
      .map((a) => ({ hit: a.effects.reduce((s, e) => s + (e.damage ?? 0), 0), cycle: (a.windup ?? 0) + (a.recovery ?? 0) + 0.7 }))
      .filter((p) => p.hit > 0);
    const hit = patterns.reduce((s, p) => s + p.hit, 0) / patterns.length;
    const cycle = patterns.reduce((s, p) => s + p.cycle, 0) / patterns.length;
    return { boss: true, hp: def.hp * mul.hp * mul.boss.hp, dps: (hit / cycle) * mul.damage * mul.boss.damage, hit: hit * mul.damage * mul.boss.damage, count: 1 };
  }
  let weight = 0;
  let hp = 0;
  let dps = 0;
  let hit = 0;
  for (const entry of zone.enemies) {
    const def = ENEMIES[entry.id];
    const threat = threatOf(def);
    weight += entry.weight;
    hp += def.hp * entry.weight;
    dps += threat.dps * entry.weight;
    hit += threat.hit * entry.weight;
  }
  const count = (zone.enemyCount[0] + zone.enemyCount[1]) / 2 + Math.floor((floorInZone - 1) * DIFFICULTY.enemiesPerFloorInZone);
  return { boss: false, hp: (hp / weight) * mul.hp, dps: (dps / weight) * mul.damage, hit: (hit / weight) * mul.damage, count };
}

/** 유효 체력: 방어력으로 줄어드는 피해를 반영한 체력. */
export function effectiveHp(maxHp, armor) {
  return (maxHp * (COMBAT.armorK + Math.max(0, armor))) / COMBAT.armorK;
}

// ── 자동 조작 ────────────────────────────────────────────────────────────────

/** 가방에서 점수가 오르는 장비를 모두 낀다. */
function equipUpgrades(game) {
  for (let guard = 0; guard < 50; guard++) {
    const bag = game.state.inventory.bag;
    let best = -1;
    let bestDelta = 1e-9;
    for (let i = 0; i < bag.length; i++) {
      const cmp = compareItem(game, i);
      if (cmp.scoreDelta > bestDelta) {
        bestDelta = cmp.scoreDelta;
        best = i;
      }
    }
    if (best === -1) return;
    equipItem(game, best);
  }
}

/** 제시된 강화 후보를 모두 무작위로 고른다. 후보가 규칙에 맞는지도 그때그때 확인한다. */
function resolveChoices(game, rng, violations) {
  const { run } = game.state;
  for (let guard = 0; guard < 200 && run.choice; guard++) {
    for (const v of checkChoice(run.choice.options, run.upgrades)) violations.push(`레벨 ${run.level} 후보: ${v}`);
    chooseUpgrade(game, rng.int(0, run.choice.options.length - 1));
  }
  if (run.choice) violations.push('강화 선택이 끝나지 않음');
}

/**
 * 런 하나를 처음부터 끝까지 돌린다.
 * @param {{ seed:string, meta?:object, floors?:number }} options
 * @returns {{ floors:object[], violations:string[], state:object }}
 *   floors[i] = 그 층에 들어섰을 때의 스냅샷 { floor, level, sheet, maxHp, armor, gold, relics, sets }
 */
export function simulateRun({ seed, meta, floors = TOTAL_FLOORS }) {
  const game = createGame({ seed, meta });
  const { state, bus } = game;
  const rng = Rng.fromSeed(`progress:${seed}`);
  const violations = [];
  const snapshots = [];
  const audit = (where) => {
    for (const v of checkState(state)) violations.push(`${where}: ${v}`);
  };

  for (let floor = 1; floor <= floors; floor++) {
    enterFloor(game, floor);
    if (floor === 1) setPhase(game, PHASE.PLAYING);
    const player = getPlayer(state);
    player.hp = player.maxHp;
    audit(`${floor}층 진입`);
    snapshots.push({
      floor,
      level: state.run.level,
      sheet: { ...state.run.sheet },
      maxHp: player.maxHp,
      armor: player.armor,
      gold: state.inventory.gold,
      relics: state.inventory.relics.length,
      upgrades: Object.values(state.run.upgrades).reduce((a, b) => a + b, 0),
      rarity: Object.values(state.inventory.equipped).map((item) => (item ? item.rarity : null)),
    });

    // 1) 적을 모두 잡는다(전투 없이 처치 보상만 받는다).
    for (const actor of allActors(state)) {
      if (actor.faction !== 'enemy' || actor.dead) continue;
      actor.hp = 0;
      actor.dead = true;
      actor.killerId = player.id;
    }
    const deaths = processDeaths(state, bus);
    if (deaths.playerDied) violations.push(`${floor}층: 플레이어가 죽음`);
    resolveChoices(game, rng, violations);

    // 2) 바닥의 것을 모두 줍는다. 가방이 차면 좋은 것은 끼고 가장 싼 것을 버린다.
    for (let guard = 0; guard < 200 && state.drops.length > 0; guard++) {
      const before = state.drops.length;
      const drop = state.drops[0];
      player.x = drop.x;
      player.y = drop.y;
      collectDrops(state, bus);
      if (state.drops.length < before) continue;
      equipUpgrades(game);
      const { bag } = state.inventory;
      if (drop.loot.kind === 'equipment' && bag.length >= state.inventory.capacity) {
        let cheapest = 0;
        for (let i = 1; i < bag.length; i++) if (sellPrice(bag[i]) < sellPrice(bag[cheapest])) cheapest = i;
        discardItem(game, cheapest);
      } else {
        // 더 가질 수 없는 것(꽉 찬 소비 아이템 묶음)은 두고 간다.
        state.drops.shift();
      }
    }
    equipUpgrades(game);
    audit(`${floor}층 줍기 뒤`);

    // 3) 상점: 남는 장비를 팔고, 점수가 오르는 것을 금화가 되는 대로 산다.
    if (state.shop) {
      player.x = state.shop.x;
      player.y = state.shop.y;
      while (state.inventory.bag.length > 0) {
        const sold = sellItem(game, state.inventory.bag.length - 1);
        if (!sold.ok) {
          violations.push(`${floor}층 상점: 판매 실패 ${sold.reason}`);
          break;
        }
      }
      for (let guard = 0; guard < 20; guard++) {
        let pick = -1;
        let bestValue = 0;
        state.shop.stock.forEach((entry, i) => {
          if (entry.sold || entry.price > state.inventory.gold) return;
          let value = 0;
          if (entry.kind === 'equipment') value = compareEquipment(state, entry.item).scoreDelta / entry.price;
          else if (entry.kind === 'relic') value = state.inventory.relics.includes(entry.id) ? 0 : 40 / entry.price;
          else if ((state.inventory.consumables[entry.id] ?? 0) < 2) value = 5 / entry.price;
          if (value > bestValue) {
            bestValue = value;
            pick = i;
          }
        });
        if (pick === -1) break;
        const bought = buyItem(game, pick);
        if (!bought.ok) {
          violations.push(`${floor}층 상점: 구매 실패 ${bought.reason}`);
          break;
        }
        equipUpgrades(game);
      }
      audit(`${floor}층 상점 뒤`);
    }

    // 4) 제단: 받을 수 있는 제안 가운데 하나를 60% 확률로 받는다.
    if (state.altar && rng.chance(0.6)) {
      player.x = state.altar.x;
      player.y = state.altar.y;
      const usable = state.altar.offers
        .map((_, i) => i)
        .filter((i) => canAccept(state.altar, i, { hp: player.hp, maxHp: player.maxHp, gold: state.inventory.gold }).ok);
      if (usable.length > 0) {
        const result = acceptAltar(game, rng.pick(usable));
        if (!result.ok) violations.push(`${floor}층 제단: ${result.reason}`);
        resolveChoices(game, rng, violations);
      }
      audit(`${floor}층 제단 뒤`);
    }
    if (state.phase !== PHASE.PLAYING) break;
  }
  return { floors: snapshots, violations, state };
}
