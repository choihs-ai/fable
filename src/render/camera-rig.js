// 카메라 추적·흔들림과 벽 가림 계산. 수식만 있다(Three.js 를 모른다) — Node 에서 테스트한다.

/**
 * 부드러운 추적: 현재 값을 목표 쪽으로 옮긴다. 프레임 길이와 무관하게 같은 속도감이 나도록 지수 감쇠를 쓴다.
 * 목표와 snapDistance 넘게 떨어져 있으면(층 이동, 순간이동) 곧바로 목표로 옮긴다.
 * @param {{x:number,y:number}} current 제자리에서 고친다
 * @param {{x:number,y:number}} target
 * @param {number} rate 초당 따라붙는 비율
 * @param {number} dtSec 프레임 길이(초)
 * @param {number} snapDistance
 * @returns {boolean} 곧바로 옮겼으면 true
 */
export function followStep(current, target, rate, dtSec, snapDistance) {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  if (dx * dx + dy * dy > snapDistance * snapDistance) {
    current.x = target.x;
    current.y = target.y;
    return true;
  }
  const t = 1 - Math.exp(-rate * Math.max(0, dtSec));
  current.x += dx * t;
  current.y += dy * t;
  return false;
}

/**
 * 플레이어를 가리는 벽: 카메라는 남쪽(+y) 위에서 보므로, 플레이어 칸의 남쪽 depth 줄 · 좌우 halfWidth 칸의 벽이 앞을 가린다.
 * @returns {number[]} 낮춰야 할 벽 칸 번호(y * width + x). 맵 밖과 바닥 칸은 빠진다
 */
export function cutawayCells(tiles, width, height, playerX, playerY, depth, halfWidth) {
  const cells = [];
  const px = Math.floor(playerX);
  const py = Math.floor(playerY);
  for (let dy = 1; dy <= depth; dy++) {
    const y = py + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const x = px + dx;
      if (x < 0 || x >= width) continue;
      if (tiles[y * width + x] === 0) cells.push(y * width + x);
    }
  }
  return cells;
}

/** 화면 비율에 따른 카메라 거리 배율: 세로 화면일수록 멀리 둔다(1 ~ portraitScale). */
export function distanceScale(aspect, portraitScale) {
  if (!(aspect > 0)) return 1;
  if (aspect >= 1) return 1;
  // 가로세로 1:1 에서 1, 9:19.5 같은 긴 세로 화면에서 portraitScale 에 가까워진다.
  const t = Math.min(1, (1 - aspect) / 0.55);
  return 1 + (portraitScale - 1) * t;
}

/**
 * 카메라 흔들림의 한 순간: 세기와 시간에서 정해지는 흔들림(여러 사인을 겹쳐 규칙적으로 보이지 않게 한다).
 * @returns {{ x:number, y:number }} 칸 단위 어긋남
 */
export function shakeOffset(amplitude, timeSec, frequency) {
  if (!(amplitude > 0)) return { x: 0, y: 0 };
  const t = timeSec * frequency;
  return {
    x: amplitude * (Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31 + 1.3) * 0.4),
    y: amplitude * (Math.sin(t * 1.13 + 0.7) * 0.6 + Math.sin(t * 2.71 + 2.1) * 0.4),
  };
}

/** 흔들림 세기를 더한다(상한 max). */
export function addShake(current, amount, max) {
  return Math.min(max, current + amount);
}

/** 흔들림 세기가 줄어든다: 초당 decay 배(지수). */
export function decayShake(current, decay, dtSec) {
  const next = current * Math.exp(-decay * Math.max(0, dtSec));
  return next < 0.002 ? 0 : next;
}
