// 시야선. 격자를 따라 한 칸씩 건너가며(DDA) 벽을 만나는지 본다. 삼각함수를 쓰지 않는다.

import { isWall } from './nav.js';

/** (x0, y0) 에서 (x1, y1) 까지 벽에 막히지 않으면 true. 양 끝 칸이 벽이면 false. */
export function lineOfSight(nav, x0, y0, x1, y1) {
  let tx = Math.floor(x0);
  let ty = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const invX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const invY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * invX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * invY : Infinity;
  // 지나가는 칸 수는 맵 크기를 넘지 않는다. 상한은 무한 루프 방지용.
  const limit = nav.w + nav.h + 4;
  for (let i = 0; i < limit; i++) {
    if (isWall(nav, tx, ty)) return false;
    if (tx === ex && ty === ey) return true;
    if (tMaxX > 1 && tMaxY > 1) return true;
    if (tMaxX < tMaxY) {
      tMaxX += invX;
      tx += stepX;
    } else {
      tMaxY += invY;
      ty += stepY;
    }
  }
  return false;
}

/** 반지름 r 인 몸이 직선으로 지나갈 수 있으면 true(중심선과 양옆 선을 모두 본다). */
export function clearPath(nav, x0, y0, x1, y1, r) {
  if (!lineOfSight(nav, x0, y0, x1, y1)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return true;
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  return (
    lineOfSight(nav, x0 + nx, y0 + ny, x1 + nx, y1 + ny) &&
    lineOfSight(nav, x0 - nx, y0 - ny, x1 - nx, y1 - ny)
  );
}
