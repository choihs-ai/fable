// 조향: 목표로 가는 방향, 위협에서 멀어지는 방향을 구한다. 플레이어 자동 조작(시뮬레이션)도 같은 함수를 쓴다.

import { COMBAT } from '../../../../data/combat.js';
import { ticksOf } from '../../core/time.js';
import { circleFree } from '../../world/collide.js';
import { clearPath } from '../../world/los.js';
import { findPath } from '../../world/pathfind.js';

const D = 0.7071;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [D, D], [D, -D], [-D, D], [-D, -D]];

/** 길찾기 기억의 초기값. */
export function createNavMemory() {
  return { path: null, idx: 0, goal: -1, repathAt: 0, failUntil: 0 };
}

/**
 * (gx, gy) 로 가기 위해 지금 움직일 방향.
 * 직선으로 갈 수 있으면 곧장 가고, 아니면 A* 경로의 경유점을 따라간다.
 * @param {object} nav navOf(map)
 * @param {{x:number,y:number,radius:number}} mover
 * @param {object} mem createNavMemory() 로 만든 기억(제자리에서 갱신)
 * @returns {{x:number,y:number,reachable:boolean}} 단위 벡터. 길이 없으면 (0,0) 과 reachable=false
 */
export function steerToward(nav, mover, mem, gx, gy, tick) {
  const dx = gx - mover.x;
  const dy = gy - mover.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-4) return { x: 0, y: 0, reachable: true };
  if (clearPath(nav, mover.x, mover.y, gx, gy, mover.radius)) {
    mem.path = null;
    return { x: dx / dist, y: dy / dist, reachable: true };
  }

  const w = nav.w;
  const goal = Math.floor(gy) * w + Math.floor(gx);
  if (!mem.path || mem.goal !== goal || tick >= mem.repathAt || mem.idx >= mem.path.length) {
    if (mem.goal === goal && mem.failUntil > tick) return { x: 0, y: 0, reachable: false };
    const clearance = mover.radius > 0.5 ? 2 : 1;
    const path = findPath(nav, Math.floor(mover.x), Math.floor(mover.y), Math.floor(gx), Math.floor(gy), clearance, COMBAT.maxPathNodes);
    const repath = ticksOf(COMBAT.repathSec);
    mem.goal = goal;
    mem.path = path;
    mem.idx = 0;
    mem.repathAt = tick + repath;
    if (!path) {
      // 길이 없으면 잠시 동안은 다시 찾지 않는다(매 틱 전체 탐색을 되풀이하지 않도록).
      mem.failUntil = tick + repath * 2;
      return { x: 0, y: 0, reachable: false };
    }
  }

  const path = mem.path;
  const reach2 = COMBAT.waypointReach * COMBAT.waypointReach;
  while (mem.idx < path.length) {
    const cell = path[mem.idx];
    const wx = (cell % w) + 0.5 - mover.x;
    const wy = Math.floor(cell / w) + 0.5 - mover.y;
    if (wx * wx + wy * wy > reach2) break;
    mem.idx++;
  }
  // 다음 경유점까지 직선으로 갈 수 있으면 건너뛴다(틱당 두 칸까지만 — 비용 제한).
  for (let skip = 0; skip < 2 && mem.idx + 1 < path.length; skip++) {
    const next = path[mem.idx + 1];
    if (!clearPath(nav, mover.x, mover.y, (next % w) + 0.5, Math.floor(next / w) + 0.5, mover.radius)) break;
    mem.idx++;
  }
  if (mem.idx >= path.length) return { x: dx / dist, y: dy / dist, reachable: true };
  const cell = path[mem.idx];
  const wx = (cell % w) + 0.5 - mover.x;
  const wy = Math.floor(cell / w) + 0.5 - mover.y;
  const wd = Math.sqrt(wx * wx + wy * wy);
  return { x: wx / wd, y: wy / wd, reachable: true };
}

/**
 * (fx, fy) 에서 멀어지는 방향. 8방향 가운데 벽에 막히지 않고 가장 잘 멀어지는 쪽을 고른다.
 * @returns {{x:number,y:number,ok:boolean}} 멀어질 방법이 없으면(구석에 몰림) ok=false
 */
export function steerAway(nav, mover, fx, fy) {
  let ax = mover.x - fx;
  let ay = mover.y - fy;
  const len = Math.sqrt(ax * ax + ay * ay);
  if (len < 1e-6) {
    ax = 1;
    ay = 0;
  } else {
    ax /= len;
    ay /= len;
  }
  let best = null;
  let bestScore = 0.1;
  for (const dir of DIRS) {
    const score = dir[0] * ax + dir[1] * ay;
    if (score <= bestScore) continue;
    if (!circleFree(nav, mover.x + dir[0] * 0.6, mover.y + dir[1] * 0.6, mover.radius)) continue;
    best = dir;
    bestScore = score;
  }
  return best ? { x: best[0], y: best[1], ok: true } : { x: 0, y: 0, ok: false };
}
