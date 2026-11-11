// 이벤트방(상점·제단). 방 가운데 칸에 상인/제단이 놓이고, 그 칸은 지나갈 수 없는 것으로 본다.
// - 방+복도 맵: 이미 있는 방 가운데 하나를 고른다.
// - 동굴 맵: 벽이 많은 자리에 사각형 방을 새로 찍는다(연결은 이후의 연결 보정이 맡는다).

import { fillRect } from './grid.js';
import { TILE } from './tiles.js';

export const EVENT_KINDS = Object.freeze(['shop', 'altar']);

function makeEventRoom(kind, x, y, w, h) {
  return { kind, x, y, w, h, feature: { x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) } };
}

/**
 * 방+복도 맵에서 조건에 맞는 방을 이벤트방으로 고른다. 맞는 방이 없으면 null.
 * @param {import('../core/prng.js').Rng} rng
 * @param {string} kind
 * @param {object[]} rooms
 * @param {Set<object>} excluded 쓸 수 없는 방(시작 방, 계단 방, 이미 쓴 방)
 * @param {Int32Array} dist 시작점에서의 걸음 수
 * @param {number} mapW
 * @param {object} cfg { minSize, minStartDist }
 */
export function pickEventRoom(rng, kind, rooms, excluded, dist, mapW, cfg) {
  const candidates = [];
  for (const room of rooms) {
    if (excluded.has(room) || room.w < cfg.minSize || room.h < cfg.minSize) continue;
    let nearest = Infinity;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const d = dist[y * mapW + x];
        if (d >= 0 && d < nearest) nearest = d;
      }
    }
    if (nearest >= cfg.minStartDist && nearest !== Infinity) candidates.push(room);
  }
  if (candidates.length === 0) return null;
  const room = rng.pick(candidates);
  excluded.add(room);
  return makeEventRoom(kind, room.x, room.y, room.w, room.h);
}

/**
 * 동굴 맵에 사각형 이벤트방을 찍는다. 방 둘레는 벽으로 두르고 내부는 바닥으로 만든다.
 * 놓을 자리가 없으면 null.
 * @param {import('../core/prng.js').Rng} rng
 * @param {string} kind
 * @param {Uint8Array} tiles
 * @param {number} w
 * @param {number} h
 * @param {{x:number,y:number}} start
 * @param {object[]} placed 이미 찍은 이벤트방
 * @param {object} cfg { size, minStartDist, candidates }
 */
export function stampEventRoom(rng, kind, tiles, w, h, start, placed, cfg) {
  const foot = cfg.size + 2;
  if (w < foot || h < foot) return null;
  let best = null;
  let bestScore = Infinity;
  for (let k = 0; k < cfg.candidates; k++) {
    // 둘레(벽)까지 포함한 자리의 왼쪽 위 칸. 둘레는 맵 테두리와 겹쳐도 된다.
    const fx = rng.int(0, w - foot);
    const fy = rng.int(0, h - foot);
    // 시작점에서 충분히 떨어져 있어야 한다(둘레까지의 체비쇼프 거리로 넉넉히 잡는다).
    const dx = Math.max(fx - start.x, start.x - (fx + foot - 1), 0);
    const dy = Math.max(fy - start.y, start.y - (fy + foot - 1), 0);
    if (Math.max(dx, dy) < cfg.minStartDist) continue;
    // 다른 이벤트방의 둘레와 겹치지 않아야 한다.
    let overlaps = false;
    for (const other of placed) {
      if (fx < other.x + other.w + 1 && other.x - 1 < fx + foot && fy < other.y + other.h + 1 && other.y - 1 < fy + foot) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    // 기존 동굴을 덜 망가뜨리는 자리(바닥이 적은 자리)를 고른다.
    let score = 0;
    for (let y = fy; y < fy + foot; y++) {
      for (let x = fx; x < fx + foot; x++) score += tiles[y * w + x] === TILE.FLOOR ? 1 : 0;
    }
    if (score < bestScore) {
      bestScore = score;
      best = { fx, fy };
    }
  }
  if (!best) return null;
  fillRect(tiles, w, best.fx, best.fy, foot, foot, TILE.WALL);
  fillRect(tiles, w, best.fx + 1, best.fy + 1, cfg.size, cfg.size, TILE.FLOOR);
  return makeEventRoom(kind, best.fx + 1, best.fy + 1, cfg.size, cfg.size);
}
