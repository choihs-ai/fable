// 원-격자 충돌. 위치는 칸 단위 실수이고 칸 (tx, ty) 는 [tx, tx+1) × [ty, ty+1) 을 차지한다.

import { isWall } from './nav.js';

/** 반지름 r 인 원이 벽과 겹치지 않으면 true. */
export function circleFree(nav, x, y, r) {
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r);
  const rr = r * r;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isWall(nav, tx, ty)) continue;
      const cx = x < tx ? tx : x > tx + 1 ? tx + 1 : x;
      const cy = y < ty ? ty : y > ty + 1 ? ty + 1 : y;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < rr) return false;
    }
  }
  return true;
}

/** 중심이 벽 칸 안에 들어간 경우: 가장 가까운 열린 변 쪽으로 밀어낸다. */
function ejectFromTile(nav, p, r, tx, ty) {
  const options = [
    [p.x - tx, tx - r, p.y, isWall(nav, tx - 1, ty)],
    [tx + 1 - p.x, tx + 1 + r, p.y, isWall(nav, tx + 1, ty)],
    [p.y - ty, p.x, ty - r, isWall(nav, tx, ty - 1)],
    [ty + 1 - p.y, p.x, ty + 1 + r, isWall(nav, tx, ty + 1)],
  ];
  let best = null;
  for (const option of options) {
    if (option[3]) continue;
    if (!best || option[0] < best[0]) best = option;
  }
  if (!best) return false;
  p.x = best[1];
  p.y = best[2];
  return true;
}

/**
 * 벽과 겹친 만큼 원을 밀어낸다. p 를 제자리에서 고친다.
 * @param {{x:number,y:number}} p
 * @returns {boolean} 벽에 닿았으면 true
 */
export function resolveCircle(nav, p, r) {
  let touched = false;
  const rr = r * r;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const x0 = Math.floor(p.x - r);
    const x1 = Math.floor(p.x + r);
    const y0 = Math.floor(p.y - r);
    const y1 = Math.floor(p.y + r);
    // 변으로 맞닿은 칸을 먼저, 모서리로만 닿는 칸을 나중에 처리해야 구석에서 떨리지 않는다.
    for (let pass = 0; pass < 2; pass++) {
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!isWall(nav, tx, ty)) continue;
          const insideX = p.x >= tx && p.x <= tx + 1;
          const insideY = p.y >= ty && p.y <= ty + 1;
          const isCorner = !insideX && !insideY;
          if ((pass === 0) === isCorner) continue;
          if (insideX && insideY) {
            if (ejectFromTile(nav, p, r, tx, ty)) {
              moved = true;
              touched = true;
            }
            continue;
          }
          const cx = p.x < tx ? tx : p.x > tx + 1 ? tx + 1 : p.x;
          const cy = p.y < ty ? ty : p.y > ty + 1 ? ty + 1 : p.y;
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr || d2 === 0) continue;
          const d = Math.sqrt(d2);
          // 아주 조금 더 밀어서 다음 검사에서 다시 걸리지 않게 한다.
          const push = r - d + 1e-9;
          p.x += (dx / d) * push;
          p.y += (dy / d) * push;
          moved = true;
          touched = true;
        }
      }
    }
    if (!moved) break;
  }
  return touched;
}

/**
 * 원을 (dx, dy) 만큼 옮기고 벽에서 밀어낸다. 한 번에 반지름의 절반 넘게 움직이면 나눠서 옮긴다(벽 통과 방지).
 * @returns {boolean} 벽에 닿았으면 true
 */
export function moveCircle(nav, p, r, dx, dy) {
  const longest = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.ceil(longest / (r * 0.5)));
  let touched = false;
  for (let i = 0; i < steps; i++) {
    p.x += dx / steps;
    p.y += dy / steps;
    if (resolveCircle(nav, p, r)) touched = true;
  }
  return touched;
}
