// 제단: 대가와 보상의 제안을 만들고, 받을 수 있는지 판단한다. 실제 적용은 logic/commands.js 가 한다.

import { ALTAR } from '../../../data/shop.js';

function resolveAmount(entry, floor) {
  return entry.base + entry.perFloor * (floor - 1);
}

/**
 * 그 층 제단의 제안 셋(작음·보통·큼)을 만든다.
 * @param {import('../core/prng.js').Rng} rng (런 시드, 층)으로 정해진 스트림
 * @returns {{ floor:number, used:boolean, offers:{ tier:string, cost:object, reward:object }[] }}
 */
export function generateAltar(rng, floor) {
  const offers = ALTAR.tiers.map((tier) => {
    const cost = { ...rng.pick(ALTAR.costs[tier]) };
    const reward = { ...rng.pick(ALTAR.rewards[tier]) };
    // 층에 따라 달라지는 금액은 여기서 확정해 둔다.
    if (cost.type === 'gold') cost.amount = resolveAmount(cost, floor);
    if (reward.type === 'gold') reward.amount = resolveAmount(reward, floor);
    return { tier, cost, reward };
  });
  return { floor, used: false, offers };
}

/** 현재 체력의 pct% (최소 1). 이 대가로 체력이 1 아래로 내려가지는 않는다. */
export function hpCost(hp, pct) {
  return Math.min(hp - 1, Math.max(1, Math.round((hp * pct) / 100)));
}

/**
 * 이 제안을 받을 수 있는가.
 * @param {{ hp:number, maxHp:number, gold:number }} player
 * @returns {{ ok:true } | { ok:false, reason:string }} reason: 'used' | 'no-such-offer' | 'no-gold' | 'too-weak'
 */
export function canAccept(altar, index, player) {
  if (altar.used) return { ok: false, reason: 'used' };
  const offer = altar.offers[index];
  if (!offer) return { ok: false, reason: 'no-such-offer' };
  const { cost } = offer;
  if (cost.type === 'gold' && player.gold < cost.amount) return { ok: false, reason: 'no-gold' };
  if (cost.type === 'hpPct' && player.hp <= 1) return { ok: false, reason: 'too-weak' };
  // 최대 체력을 바치고도 최소 10 은 남아야 한다.
  if (cost.type === 'maxHp' && player.maxHp - cost.amount < 10) return { ok: false, reason: 'too-weak' };
  return { ok: true };
}
