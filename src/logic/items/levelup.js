// 레벨과 강화 3택1. 규칙은 data/upgrades.js 머리말에 적혀 있다.
// 여기 함수들은 런 진행 객체(state.run)만 고친다.

import { FILLERS, LEVELING, UPGRADES } from '../../../data/upgrades.js';

/** 이 레벨에서 다음 레벨까지 필요한 경험치. */
export function xpToNext(level) {
  const n = level - 1;
  return LEVELING.xp.base + LEVELING.xp.linear * n + LEVELING.xp.quad * n * n;
}

/** 적 하나가 주는 경험치(경험치 획득 보너스 적용 전). */
export function xpForKill(maxHp, isBoss) {
  return Math.max(1, Math.round(maxHp * LEVELING.xpPerHp * (isBoss ? LEVELING.bossMul : 1)));
}

/** 지금 후보가 될 수 있는 강화 id 들(단계 상한·선행 조건·배타 규칙을 통과한 것). */
export function eligibleUpgrades(owned) {
  return Object.keys(UPGRADES).filter((id) => {
    const def = UPGRADES[id];
    if ((owned[id] ?? 0) >= def.maxRank) return false;
    for (const req of Object.keys(def.requires ?? {})) {
      if ((owned[req] ?? 0) < def.requires[req]) return false;
    }
    for (const other of def.excludes ?? []) {
      if ((owned[other] ?? 0) > 0) return false;
    }
    return true;
  });
}

/** 시너지를 반영한 가중치: 가진 강화와 태그가 겹칠수록 커진다. */
export function upgradeWeight(id, owned) {
  const def = UPGRADES[id];
  let shared = 0;
  for (const other of Object.keys(owned)) {
    if (other === id || owned[other] < 1) continue;
    if (UPGRADES[other].tags.some((tag) => def.tags.includes(tag))) shared++;
  }
  return def.weight * Math.min(LEVELING.synergyCap, 1 + LEVELING.synergyBonus * shared);
}

/**
 * 강화 후보 셋을 뽑는다. 서로 다른 강화이고, 모자라면 채움 보상으로 채운다.
 * @returns {{ kind:'upgrade'|'filler', id:string }[]} 길이는 항상 LEVELING.choices
 */
export function rollChoices(rng, owned) {
  const pool = eligibleUpgrades(owned);
  const options = [];
  while (options.length < LEVELING.choices && pool.length > 0) {
    const pick = rng.weightedIndex(pool.map((id) => upgradeWeight(id, owned)));
    options.push({ kind: 'upgrade', id: pool.splice(pick, 1)[0] });
  }
  for (const id of Object.keys(FILLERS)) {
    if (options.length >= LEVELING.choices) break;
    options.push({ kind: 'filler', id });
  }
  return options;
}

/**
 * 경험치를 얻는다. 레벨이 오르면 그만큼 선택이 쌓인다(run.pendingChoices).
 * @returns {number} 오른 레벨 수
 */
export function gainXp(run, amount) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`gainXp: 잘못된 경험치 ${amount}`);
  run.xp += amount;
  let gained = 0;
  // 한 번에 여러 레벨이 오를 수 있다. 상한은 무한 루프 방지용.
  while (run.xp >= xpToNext(run.level) && gained < 100) {
    run.xp -= xpToNext(run.level);
    run.level++;
    run.pendingChoices++;
    gained++;
  }
  return gained;
}

/** 쌓인 선택이 있고 지금 제시된 후보가 없으면 후보를 뽑아 run.choice 에 둔다. @returns {boolean} 새로 뽑았는가 */
export function offerChoice(run, rng) {
  if (run.choice || run.pendingChoices < 1) return false;
  run.pendingChoices--;
  run.choice = { options: rollChoices(rng, run.upgrades) };
  return true;
}

/**
 * 제시된 후보 가운데 하나를 고른다. 강화면 단계를 올리고, 능력치형 채움 보상이면 영구 효과로 더한다.
 * 회복·금화형 채움 보상은 호출하는 쪽이 적용하도록 그대로 돌려준다.
 * @returns {{ kind:string, id:string, effect?:object, rank?:number }}
 */
export function takeChoice(run, index) {
  if (!run.choice) throw new Error('takeChoice: 제시된 후보가 없습니다');
  const option = run.choice.options[index];
  if (!option) throw new RangeError(`takeChoice: ${index}번 후보가 없습니다`);
  run.choice = null;
  if (option.kind === 'upgrade') {
    run.upgrades[option.id] = (run.upgrades[option.id] ?? 0) + 1;
    return { kind: 'upgrade', id: option.id, rank: run.upgrades[option.id] };
  }
  const effect = FILLERS[option.id].effect;
  if (effect.type === 'stats') run.boons.push({ source: `filler:${option.id}`, stats: { ...effect.stats } });
  return { kind: 'filler', id: option.id, effect };
}
