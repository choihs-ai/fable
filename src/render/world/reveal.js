// 방 단위 공개와 벽 낮추기의 계산. 수식만 있다(Three.js 를 모른다) — Node 에서 테스트한다.
//
// - 구역(region): 방은 방 번호, 복도는 (방의 수 + 복도 번호). logic/world/structure.js 와 같은 번호다.
// - 드러난 구역은 밝기 1, 아직인 구역은 0. 바뀌면 칸마다 끊기지 않고 구역 전체가 같은 빠르기로 부드럽게 바뀐다.
// - 벽은 그 벽에 맞닿은 구역 가운데 가장 밝은 것을 따른다(드러난 방의 벽만 보인다).

/** 구역마다 드러났는가(1) 아닌가(0). 길이 = 방의 수 + 복도의 수. */
export function regionTargets(world) {
  const out = new Float32Array(world.rooms.length + world.links.length);
  world.rooms.forEach((room, i) => {
    out[i] = room.seen ? 1 : 0;
  });
  world.links.forEach((link, i) => {
    out[world.rooms.length + i] = link.seen ? 1 : 0;
  });
  return out;
}

/**
 * current 를 target 쪽으로 한 프레임만큼 옮긴다(직선, 1 만큼 바뀌는 데 durationSec 초).
 * @returns {number[]} 바뀐 칸의 번호
 */
export function stepToward(current, target, durationSec, dtSec) {
  const step = durationSec > 0 ? Math.max(0, dtSec) / durationSec : 1;
  const changed = [];
  for (let i = 0; i < current.length; i++) {
    const d = target[i] - current[i];
    if (d === 0) continue;
    current[i] = Math.abs(d) <= step ? target[i] : current[i] + Math.sign(d) * step;
    changed.push(i);
  }
  return changed;
}

/**
 * 벽 칸마다 맞닿은(8방향) 구역들. 바닥에 닿지 않는 벽은 빈 목록.
 * @param {Int16Array} regionAt 칸 → 구역 번호(막힌 칸 -1)
 * @param {number[]} wallCells 그릴 벽 칸
 * @returns {number[][]}
 */
export function wallNeighbors(regionAt, width, height, wallCells) {
  return wallCells.map((cell) => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    const found = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const r = regionAt[ny * width + nx];
        if (r >= 0 && !found.includes(r)) found.push(r);
      }
    }
    return found;
  });
}

/** 벽의 밝기: 맞닿은 구역 가운데 가장 밝은 것. */
export function wallBrightness(neighbors, brightness) {
  let best = 0;
  for (const r of neighbors) if (brightness[r] > best) best = brightness[r];
  return best;
}

/**
 * 지수 감쇠로 목표 높이에 다가간다(프레임 길이와 무관한 빠르기). 충분히 가까우면 목표로 맞춘다.
 * @returns {number}
 */
export function approach(current, target, rate, dtSec) {
  const d = target - current;
  if (Math.abs(d) < 1e-3) return target;
  return current + d * (1 - Math.exp(-rate * Math.max(0, dtSec)));
}
