// 맵에서 뽑아 낸 이동·탐색용 자료. 맵의 tiles 배열마다 한 번 만들어 두고 다시 쓴다.
// 상태(state)에는 들어가지 않는다 — 세이브를 불러오면 tiles 에서 다시 만들어진다.

import { isClear } from './grid.js';
import { readStructure } from './structure.js';
import { TILE } from './tiles.js';

const cache = new WeakMap();

/**
 * @param {{ width:number, height:number, tiles:number[] }} map
 * @returns {{ w:number, h:number, tiles:Uint8Array, clear:Uint8Array }} clear: 0 벽, 1 바닥, 2 둘레 8칸까지 모두 바닥
 */
export function navOf(map) {
  let nav = cache.get(map.tiles);
  if (!nav) {
    nav = buildNav(map.tiles, map.width, map.height);
    // 칸 → 구역 번호(방은 방 번호, 복도는 방의 수 + 복도 번호, 막힌 칸은 -1). 방 목록이 없는 맵(테스트용 전장)은 전부 -1.
    nav.roomCount = Array.isArray(map.rooms) ? map.rooms.length : 0;
    nav.region = nav.roomCount > 0 ? readStructure(map.tiles, map.width, map.height, map.rooms).regionAt : new Int16Array(map.tiles.length).fill(-1);
    cache.set(map.tiles, nav);
  }
  return nav;
}

/** (x, y) 가 속한 구역 번호. 막힌 칸·맵 밖은 -1. */
export function regionAt(nav, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return tx < 0 || ty < 0 || tx >= nav.w || ty >= nav.h ? -1 : nav.region[ty * nav.w + tx];
}

/**
 * 맵의 칸을 바꾼다(문을 열고 닫을 때). map.tiles 와 nav 를 함께 고치고, 둘레의 여유(clear)를 다시 계산한다.
 * @param {object} map
 * @param {number[]} cells
 * @param {number} tile
 */
export function setTiles(map, cells, tile) {
  const nav = navOf(map);
  for (const c of cells) {
    map.tiles[c] = tile;
    nav.tiles[c] = tile;
  }
  const { w, h, tiles, clear } = nav;
  for (const c of cells) {
    const cx = c % w;
    const cy = Math.floor(c / w);
    for (let y = Math.max(0, cy - 1); y <= Math.min(h - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(w - 1, cx + 1); x++) {
        const i = y * w + x;
        if (tiles[i] !== TILE.FLOOR) {
          clear[i] = 0;
          continue;
        }
        clear[i] = x > 0 && y > 0 && x < w - 1 && y < h - 1 && isClear(tiles, w, i) ? 2 : 1;
      }
    }
  }
}

/** 타일 배열에서 바로 만든다(테스트용으로도 쓴다). */
export function buildNav(sourceTiles, w, h) {
  const size = w * h;
  const tiles = Uint8Array.from(sourceTiles);
  const clear = new Uint8Array(size);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tiles[i] !== TILE.FLOOR) continue;
      clear[i] = x > 0 && y > 0 && x < w - 1 && y < h - 1 && isClear(tiles, w, i) ? 2 : 1;
    }
  }
  return {
    w, h, tiles, clear,
    // A* 가 쓰는 작업 공간(호출마다 다시 쓰고, stamp 로 이전 내용을 무효화한다).
    g: new Int32Array(size), from: new Int32Array(size), seen: new Int32Array(size), closed: new Int32Array(size), stamp: 0,
  };
}

/** 맵 밖은 벽으로 본다. */
export function isWall(nav, tx, ty) {
  return tx < 0 || ty < 0 || tx >= nav.w || ty >= nav.h || nav.tiles[ty * nav.w + tx] !== TILE.FLOOR;
}
