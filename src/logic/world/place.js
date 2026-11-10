// 적·아이템 배치. 벽·이벤트방·이미 쓴 칸을 피하고 시작점에서 일정 걸음 이상 떨어진 칸에만 놓는다.

import { DIFFICULTY } from '../../../data/difficulty.js';
import { TILE } from './tiles.js';

/** 구역 안에서의 순번에 따라 더 놓는 적의 수(난이도 곡선의 밀도). */
export function extraEnemies(floorInZone) {
  return Math.floor((floorInZone - 1) * DIFFICULTY.enemiesPerFloorInZone);
}

/** 조건에 맞는 칸 가운데 count 개를 겹치지 않게 고른다(후보가 모자라면 있는 만큼만). */
function pickCells(rng, tiles, dist, occupied, forbidden, minDist, count) {
  const candidates = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE.FLOOR && dist[i] >= minDist && !occupied[i] && !forbidden[i]) candidates.push(i);
  }
  const n = Math.min(count, candidates.length);
  const picked = [];
  for (let k = 0; k < n; k++) {
    const j = rng.int(k, candidates.length - 1);
    const cell = candidates[j];
    candidates[j] = candidates[k];
    candidates[k] = cell;
    occupied[cell] = 1;
    picked.push(cell);
  }
  return picked;
}

/**
 * @param {import('../core/prng.js').Rng} rng
 * @param {object} ctx
 * @param {Uint8Array} ctx.tiles
 * @param {number} ctx.w
 * @param {Int32Array} ctx.dist 시작점에서의 걸음 수(닿지 못하는 칸은 -1)
 * @param {Uint8Array} ctx.occupied 이미 쓴 칸(시작점·계단·상인/제단). 배치하면서 갱신된다
 * @param {Uint8Array} ctx.forbidden 놓을 수 없는 칸(이벤트방 내부)
 * @param {object} ctx.zone 구역 데이터
 * @param {object} ctx.cfg WORLD.placement
 * @param {number} ctx.floorInZone 구역 안에서의 순번(1부터)
 * @returns {object[]} spawns
 */
export function placeSpawns(rng, { tiles, w, dist, occupied, forbidden, zone, cfg, floorInZone }) {
  const spawns = [];
  const weights = zone.enemies.map((e) => e.weight);

  // 밀도: 구역 안에서 층이 깊어질수록 적이 늘어난다.
  const enemyCount = rng.int(zone.enemyCount[0], zone.enemyCount[1]) + extraEnemies(floorInZone);
  for (const cell of pickCells(rng, tiles, dist, occupied, forbidden, cfg.enemyMinStartDist, enemyCount)) {
    const id = zone.enemies[rng.weightedIndex(weights)].id;
    spawns.push({ kind: 'enemy', id, x: cell % w, y: Math.floor(cell / w) });
  }

  const itemCount = rng.int(zone.itemCount[0], zone.itemCount[1]);
  for (const cell of pickCells(rng, tiles, dist, occupied, forbidden, cfg.itemMinStartDist, itemCount)) {
    // 무엇이 들어 있는지는 층에 들어갈 때 정해진다(combat/loot.js 의 setupFloorLoot).
    spawns.push({ kind: 'item', x: cell % w, y: Math.floor(cell / w) });
  }

  return spawns;
}
