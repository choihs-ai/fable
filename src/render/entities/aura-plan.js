// 축복의 기운 계산(Three.js 를 모른다 — Node 에서 테스트한다).
// 가진 축복의 계열을 세어, 몸 둘레를 도는 구슬(계열마다)과 발밑 고리 수, 고리 색(가장 많은 계열)을 정한다.

const FAMILIES = ['fire', 'bolt', 'ice'];

/**
 * @param {string[]} boons 가진 축복 id
 * @param {Record<string, {family:string|null, duo?:string[]}>} table 축복 정의(data/boons.js 의 BOONS)
 * @param {{ perOrb:number, maxOrbs:number, ringsAt:number[] }} cfg FEEL.aura
 * @returns {{ counts:Record<string, number>, orbs:{ family:string, index:number, of:number }[], rings:number, dominant:string }}
 */
export function auraPlan(boons, table, cfg) {
  const counts = { fire: 0, bolt: 0, ice: 0 };
  for (const id of boons) {
    const boon = Object.hasOwn(table, id) ? table[id] : null;
    // 합성 축복(duo)은 두 계열을 모두 센다.
    const families = !boon ? [] : Array.isArray(boon.duo) ? boon.duo : boon.family ? [boon.family] : [];
    for (const f of families) if (Object.hasOwn(counts, f)) counts[f] += 1;
  }
  const orbs = [];
  for (const family of FAMILIES) {
    const n = Math.min(cfg.maxOrbs, Math.ceil(counts[family] / cfg.perOrb));
    for (let i = 0; i < n; i++) orbs.push({ family, index: i, of: n });
  }
  let rings = 0;
  for (const at of cfg.ringsAt) if (boons.length >= at) rings++;
  let dominant = 'none';
  let best = 0;
  for (const family of FAMILIES) {
    if (counts[family] > best) {
      best = counts[family];
      dominant = family;
    }
  }
  return { counts, orbs, rings, dominant };
}
