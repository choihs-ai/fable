// 이벤트방(상점·보상). 이미 있는 방 가운데 조건에 맞는 것을 골라 쓴다. 방 한가운데에 상인/상자가 놓인다.

export const EVENT_KINDS = Object.freeze(['shop', 'reward']);

/**
 * 조건에 맞는 방을 이벤트방으로 고른다. 맞는 방이 없으면 null.
 * @param {import('../core/prng.js').Rng} rng
 * @param {object[]} rooms 후보(이미 쓰임새가 정해진 방은 빼고 넘긴다)
 * @param {{ minDepth:number, preferLeaf:boolean }} cfg 시작 방에서의 최소 깊이, 막다른 방을 먼저 고를지
 * @param {(room:object) => number} depthOf 방의 깊이
 * @param {(room:object) => number} degreeOf 방에 이어진 복도 수
 * @returns {object|null}
 */
export function pickEventRoom(rng, rooms, cfg, depthOf, degreeOf) {
  const candidates = rooms.filter((room) => depthOf(room) >= cfg.minDepth);
  if (candidates.length === 0) return null;
  if (cfg.preferLeaf) {
    const leaves = candidates.filter((room) => degreeOf(room) === 1);
    if (leaves.length > 0) return rng.pick(leaves);
  }
  return rng.pick(candidates);
}
