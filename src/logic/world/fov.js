// 시야 계산(레이캐스트). 관찰자 칸에서 시야 정사각형의 테두리 칸마다 선을 쏘고, 벽을 만나면 멈춘다.
// 삼각함수 없이 정수 선분(브레젠험)만 쓴다.

import { TILE } from './tiles.js';

/**
 * @param {{w:number,h:number,tiles:Uint8Array}} nav
 * @param {number} ox 관찰자 칸 x
 * @param {number} oy 관찰자 칸 y
 * @param {number} radius 시야 반경(칸)
 * @param {number[]|Uint8Array} out 길이 w*h. 보이는 칸은 1, 아니면 0 으로 채운다
 * @returns {number} 보이는 칸 수
 */
export function computeFov(nav, ox, oy, radius, out) {
  const { w, h, tiles } = nav;
  for (let i = 0; i < w * h; i++) out[i] = 0;
  if (ox < 0 || oy < 0 || ox >= w || oy >= h) return 0;
  const r2 = radius * radius;
  out[oy * w + ox] = 1;

  const cast = (ex, ey) => {
    let x = ox;
    let y = oy;
    const dx = Math.abs(ex - ox);
    const dy = Math.abs(ey - oy);
    const sx = ox < ex ? 1 : -1;
    const sy = oy < ey ? 1 : -1;
    let err = dx - dy;
    while (x !== ex || y !== ey) {
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if ((x - ox) * (x - ox) + (y - oy) * (y - oy) > r2) return;
      out[y * w + x] = 1;
      if (tiles[y * w + x] !== TILE.FLOOR) return;
    }
  };

  for (let d = -radius; d <= radius; d++) {
    cast(ox + d, oy - radius);
    cast(ox + d, oy + radius);
    cast(ox - radius, oy + d);
    cast(ox + radius, oy + d);
  }

  // 선과 선 사이로 빠진 벽 보정: 보이는 바닥에 붙은 벽은 보이는 것으로 한다(벽에 구멍이 난 것처럼 보이지 않게).
  let count = 0;
  const y0 = Math.max(1, oy - radius);
  const y1 = Math.min(h - 2, oy + radius);
  const x0 = Math.max(1, ox - radius);
  const x1 = Math.min(w - 2, ox + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (out[i] !== 1 || tiles[i] !== TILE.FLOOR) continue;
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          const n = ny * w + nx;
          if (tiles[n] !== TILE.FLOOR && out[n] === 0) out[n] = 2;
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (out[i] !== 0) {
      out[i] = 1;
      count++;
    }
  }
  return count;
}
