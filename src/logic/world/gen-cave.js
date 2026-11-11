// 동굴형 맵: 무작위로 채운 뒤 셀룰러 오토마타로 다듬는다. 연결 보정은 호출하는 쪽(generate.js)이 한다.

import { TILE } from './tiles.js';

/**
 * @param {import('../core/prng.js').Rng} rng
 * @param {number} w
 * @param {number} h
 * @param {object} cfg WORLD.cave
 * @returns {{ tiles: Uint8Array, rooms: object[] }}
 */
export function generateCave(rng, w, h, cfg) {
  const size = w * h;
  let cur = new Uint8Array(size);
  let next = new Uint8Array(size);
  const threshold = Math.floor(cfg.fillChance * 0x100000000);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      cur[y * w + x] = rng.nextUint32() < threshold ? TILE.WALL : TILE.FLOOR;
    }
  }

  for (let step = 0; step < cfg.smoothSteps; step++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        // 주변 8칸의 바닥 수를 세어 벽 수로 바꾼다(맵 밖은 테두리 벽이 대신한다).
        const floors =
          cur[i - w - 1] + cur[i - w] + cur[i - w + 1] +
          cur[i - 1] + cur[i + 1] +
          cur[i + w - 1] + cur[i + w] + cur[i + w + 1];
        const walls = 8 - floors;
        const isWall = cur[i] === TILE.WALL;
        next[i] = walls >= cfg.wallThreshold || (isWall && walls >= cfg.wallThreshold - 1) ? TILE.WALL : TILE.FLOOR;
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }

  return { tiles: cur, rooms: [] };
}
