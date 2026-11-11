// 연결 보정: 떨어져 있는 바닥 구역을 본 구역에 잇거나 메운다. 끝나면 바닥은 하나의 구역만 남는다.

import { labelRegions } from './grid.js';
import { TILE } from './tiles.js';

/**
 * tiles 를 제자리에서 고친다. 난수를 쓰지 않는다(같은 입력이면 같은 결과).
 * @param {Uint8Array} tiles
 * @param {number} w
 * @param {number} h
 * @param {object} options
 * @param {number} options.anchor 본 구역에 속한 칸 인덱스. -1 이면 가장 큰 구역이 본 구역이 된다.
 * @param {Uint8Array|null} options.keep 0 이 아닌 칸이 든 구역은 작아도 메우지 않고 잇는다
 * @param {number} options.minRegionSize 이보다 작은 외딴 구역은 메운다
 * @returns {{ tunnels: number, filled: number }} 판 굴 수와 메운 구역 수
 */
export function connectRegions(tiles, w, h, { anchor = -1, keep = null, minRegionSize }) {
  const size = w * h;
  const { labels, sizes } = labelRegions(tiles, w, h);
  if (sizes.length <= 1) return { tunnels: 0, filled: 0 };

  let main = anchor >= 0 ? labels[anchor] : -1;
  if (main === -1) {
    main = 0;
    for (let r = 1; r < sizes.length; r++) if (sizes[r] > sizes[main]) main = r;
  }

  const hasKeep = new Uint8Array(sizes.length);
  if (keep) {
    for (let i = 0; i < size; i++) if (keep[i] && labels[i] !== -1) hasKeep[labels[i]] = 1;
  }

  // 1) 작은 외딴 구역은 메운다.
  const fill = new Uint8Array(sizes.length);
  let filled = 0;
  for (let r = 0; r < sizes.length; r++) {
    if (r !== main && sizes[r] < minRegionSize && !hasKeep[r]) {
      fill[r] = 1;
      filled++;
    }
  }
  if (filled > 0) {
    for (let i = 0; i < size; i++) {
      if (labels[i] !== -1 && fill[labels[i]]) {
        tiles[i] = TILE.WALL;
        labels[i] = -1;
      }
    }
  }

  // 2) 남은 구역은 본 구역에서 가장 가까운 것부터 굴을 파서 잇는다.
  let pending = 0;
  for (let r = 0; r < sizes.length; r++) if (r !== main && !fill[r]) pending++;

  const inMain = new Uint8Array(size);
  for (let i = 0; i < size; i++) if (labels[i] === main) inMain[i] = 1;

  const parent = new Int32Array(size);
  const queue = new Int32Array(size);
  let tunnels = 0;
  while (pending > 0) {
    // 본 구역 전체에서 동시에 퍼져 나가(벽도 통과) 처음 만나는 다른 구역의 칸을 찾는다. 테두리는 지나지 않는다.
    parent.fill(-2);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < size; i++) {
      if (inMain[i]) {
        parent[i] = -1;
        queue[tail++] = i;
      }
    }
    let hit = -1;
    while (head < tail && hit === -1) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = k === 2 ? x - 1 : k === 3 ? x + 1 : x;
        const ny = k === 0 ? y - 1 : k === 1 ? y + 1 : y;
        if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
        const n = ny * w + nx;
        if (parent[n] !== -2) continue;
        parent[n] = i;
        if (tiles[n] === TILE.FLOOR) {
          hit = n;
          break;
        }
        queue[tail++] = n;
      }
    }
    if (hit === -1) {
      // 닿을 수 없는 구역(있을 수 없지만, 테두리에만 붙은 경우 대비)은 메운다.
      for (let i = 0; i < size; i++) {
        if (tiles[i] === TILE.FLOOR && !inMain[i]) {
          tiles[i] = TILE.WALL;
          labels[i] = -1;
        }
      }
      filled += pending;
      break;
    }
    // 찾은 칸에서 본 구역까지 되짚어 가며 벽을 바닥으로 바꾼다.
    for (let i = parent[hit]; i !== -1 && !inMain[i]; i = parent[i]) {
      tiles[i] = TILE.FLOOR;
      inMain[i] = 1;
    }
    const region = labels[hit];
    for (let i = 0; i < size; i++) if (labels[i] === region) inMain[i] = 1;
    pending--;
    tunnels++;
  }

  return { tunnels, filled };
}
