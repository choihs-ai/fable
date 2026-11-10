// 방+복도 맵: 공간을 이진 분할(BSP)해 조각마다 방을 하나씩 두고, 형제 조각끼리 복도로 잇는다.

import { fillRect } from './grid.js';
import { TILE } from './tiles.js';

function carveCorridor(tiles, w, x1, y1, x2, y2, horizontalFirst) {
  let x = x1;
  let y = y1;
  const stepX = () => {
    while (x !== x2) {
      tiles[y * w + x] = TILE.FLOOR;
      x += x < x2 ? 1 : -1;
    }
  };
  const stepY = () => {
    while (y !== y2) {
      tiles[y * w + x] = TILE.FLOOR;
      y += y < y2 ? 1 : -1;
    }
  };
  if (horizontalFirst) {
    stepX();
    stepY();
  } else {
    stepY();
    stepX();
  }
  tiles[y * w + x] = TILE.FLOOR;
}

function connectRooms(rng, tiles, w, a, b) {
  const x1 = rng.int(a.x, a.x + a.w - 1);
  const y1 = rng.int(a.y, a.y + a.h - 1);
  const x2 = rng.int(b.x, b.x + b.w - 1);
  const y2 = rng.int(b.y, b.y + b.h - 1);
  carveCorridor(tiles, w, x1, y1, x2, y2, rng.chance(0.5));
}

function centerDistance(a, b) {
  return Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) + Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
}

/**
 * @param {import('../core/prng.js').Rng} rng
 * @param {number} w
 * @param {number} h
 * @param {object} cfg WORLD.rooms
 * @returns {{ tiles: Uint8Array, rooms: {x:number,y:number,w:number,h:number}[] }}
 */
export function generateRooms(rng, w, h, cfg) {
  const tiles = new Uint8Array(w * h);
  const rooms = [];

  // 조각을 나누고, 잎마다 방을 만든 뒤, 돌아오면서 양쪽 자식의 방 목록을 합친다.
  const build = (x, y, lw, lh) => {
    const canSplitX = lw >= cfg.minLeaf * 2;
    const canSplitY = lh >= cfg.minLeaf * 2;
    const mustSplit = lw > cfg.maxLeaf || lh > cfg.maxLeaf;
    const stop = !mustSplit && rng.chance(cfg.stopChance);
    if ((!canSplitX && !canSplitY) || stop) {
      const maxW = lw - 2;
      const maxH = lh - 2;
      const rw = rng.int(Math.max(cfg.roomMin, Math.floor(maxW * cfg.roomFillMin)), maxW);
      const rh = rng.int(Math.max(cfg.roomMin, Math.floor(maxH * cfg.roomFillMin)), maxH);
      const room = { x: x + 1 + rng.int(0, maxW - rw), y: y + 1 + rng.int(0, maxH - rh), w: rw, h: rh };
      fillRect(tiles, w, room.x, room.y, room.w, room.h, TILE.FLOOR);
      rooms.push(room);
      return [room];
    }

    let splitX;
    if (canSplitX && canSplitY) {
      if (lw >= lh * 1.25) splitX = true;
      else if (lh >= lw * 1.25) splitX = false;
      else splitX = rng.chance(0.5);
    } else {
      splitX = canSplitX;
    }

    let first;
    let second;
    if (splitX) {
      const cut = rng.int(cfg.minLeaf, lw - cfg.minLeaf);
      first = build(x, y, cut, lh);
      second = build(x + cut, y, lw - cut, lh);
    } else {
      const cut = rng.int(cfg.minLeaf, lh - cfg.minLeaf);
      first = build(x, y, lw, cut);
      second = build(x, y + cut, lw, lh - cut);
    }

    // 양쪽에서 가장 가까운 방 한 쌍을 잇는다.
    let bestA = first[0];
    let bestB = second[0];
    let best = Infinity;
    for (const a of first) {
      for (const b of second) {
        const d = centerDistance(a, b);
        if (d < best) {
          best = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    connectRooms(rng, tiles, w, bestA, bestB);
    return first.concat(second);
  };

  build(1, 1, w - 2, h - 2);

  // 순환로: 서로 다른 방 몇 쌍을 더 잇는다.
  if (rooms.length >= 3) {
    const extra = rng.int(0, Math.floor(rooms.length * cfg.extraCorridorRatio));
    for (let i = 0; i < extra; i++) {
      const a = rooms[rng.int(0, rooms.length - 1)];
      let b = a;
      let best = Infinity;
      // a 에서 가까운 방 셋 중 하나를 고르기 위해, 무작위로 뽑은 후보 가운데 가장 가까운 것을 쓴다.
      for (let k = 0; k < 3; k++) {
        const c = rooms[rng.int(0, rooms.length - 1)];
        if (c === a) continue;
        const d = centerDistance(a, c);
        if (d < best) {
          best = d;
          b = c;
        }
      }
      if (b !== a) connectRooms(rng, tiles, w, a, b);
    }
  }

  return { tiles, rooms };
}
