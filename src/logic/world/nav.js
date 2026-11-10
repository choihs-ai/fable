// 맵에서 뽑아 낸 이동·탐색용 자료. 맵의 tiles 배열마다 한 번 만들어 두고 다시 쓴다.
// 상태(state)에는 들어가지 않는다 — 세이브를 불러오면 tiles 에서 다시 만들어진다.

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
    cache.set(map.tiles, nav);
  }
  return nav;
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
      let open = x > 0 && y > 0 && x < w - 1 && y < h - 1;
      if (open) {
        open =
          tiles[i - w - 1] + tiles[i - w] + tiles[i - w + 1] + tiles[i - 1] + tiles[i + 1] +
          tiles[i + w - 1] + tiles[i + w] + tiles[i + w + 1] === 8 * TILE.FLOOR;
      }
      clear[i] = open ? 2 : 1;
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
