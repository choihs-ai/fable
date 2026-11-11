// 격자 탐색 도구. 이동은 상하좌우 4방향만 센다(대각선으로 벽 모서리를 빠져나가는 경로는 인정하지 않는다).

import { TILE } from './tiles.js';

/**
 * start 에서 각 칸까지의 걸음 수. 닿지 못하는 칸은 -1.
 * @param {ArrayLike<number>} tiles
 * @param {number} w
 * @param {number} h
 * @param {number} start 시작 칸 인덱스
 * @param {ArrayLike<number>|null} [blocked] 0 이 아닌 칸은 바닥이어도 지나갈 수 없다
 * @returns {Int32Array}
 */
export function bfsDistances(tiles, w, h, start, blocked = null) {
  const size = w * h;
  const dist = new Int32Array(size).fill(-1);
  if (start < 0 || start >= size || tiles[start] !== TILE.FLOOR) return dist;
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  const lastRow = size - w;
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i] + 1;
    const x = i % w;
    if (i >= w) {
      const n = i - w;
      if (dist[n] === -1 && tiles[n] === TILE.FLOOR && !(blocked && blocked[n])) {
        dist[n] = d;
        queue[tail++] = n;
      }
    }
    if (i < lastRow) {
      const n = i + w;
      if (dist[n] === -1 && tiles[n] === TILE.FLOOR && !(blocked && blocked[n])) {
        dist[n] = d;
        queue[tail++] = n;
      }
    }
    if (x > 0) {
      const n = i - 1;
      if (dist[n] === -1 && tiles[n] === TILE.FLOOR && !(blocked && blocked[n])) {
        dist[n] = d;
        queue[tail++] = n;
      }
    }
    if (x < w - 1) {
      const n = i + 1;
      if (dist[n] === -1 && tiles[n] === TILE.FLOOR && !(blocked && blocked[n])) {
        dist[n] = d;
        queue[tail++] = n;
      }
    }
  }
  return dist;
}

/**
 * 서로 이어진 바닥 칸끼리 같은 번호를 붙인다.
 * @returns {{ labels: Int32Array, sizes: number[] }} labels 는 칸별 구역 번호(벽은 -1), sizes 는 구역별 칸 수
 */
export function labelRegions(tiles, w, h) {
  const size = w * h;
  const labels = new Int32Array(size).fill(-1);
  const sizes = [];
  const queue = new Int32Array(size);
  const lastRow = size - w;
  for (let s = 0; s < size; s++) {
    if (tiles[s] !== TILE.FLOOR || labels[s] !== -1) continue;
    const label = sizes.length;
    let head = 0;
    let tail = 0;
    labels[s] = label;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (i >= w && tiles[i - w] === TILE.FLOOR && labels[i - w] === -1) {
        labels[i - w] = label;
        queue[tail++] = i - w;
      }
      if (i < lastRow && tiles[i + w] === TILE.FLOOR && labels[i + w] === -1) {
        labels[i + w] = label;
        queue[tail++] = i + w;
      }
      if (x > 0 && tiles[i - 1] === TILE.FLOOR && labels[i - 1] === -1) {
        labels[i - 1] = label;
        queue[tail++] = i - 1;
      }
      if (x < w - 1 && tiles[i + 1] === TILE.FLOOR && labels[i + 1] === -1) {
        labels[i + 1] = label;
        queue[tail++] = i + 1;
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

/** 사각형 영역을 한 가지 타일로 채운다. */
export function fillRect(tiles, w, x, y, rw, rh, tile) {
  for (let yy = y; yy < y + rh; yy++) {
    const row = yy * w;
    for (let xx = x; xx < x + rw; xx++) tiles[row + xx] = tile;
  }
}
