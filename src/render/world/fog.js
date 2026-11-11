// 시야 안개 단계 계산. 로직의 state.vision(보이는 칸·탐험한 칸)을 읽어 칸마다 단계를 정한다.
// Three.js 를 모른다 — Node 에서 테스트한다.

export const FOG = Object.freeze({ HIDDEN: 0, EXPLORED: 1, VISIBLE: 2 });

/** 바닥 칸의 단계. */
export function floorLevel(vision, cell) {
  if (vision.visible[cell] === 1) return FOG.VISIBLE;
  return vision.explored[cell] === 1 ? FOG.EXPLORED : FOG.HIDDEN;
}

/**
 * 벽 칸의 단계: 자기 칸과 둘레 8칸 가운데 가장 밝은 단계를 따른다.
 * (시야 계산이 벽 칸 자체를 "보임"으로 표시하지 않아도, 보이는 바닥에 맞닿은 벽은 보인다.)
 */
export function wallLevel(vision, width, height, cell) {
  const cx = cell % width;
  const cy = (cell - cx) / width;
  let level = FOG.HIDDEN;
  for (let dy = -1; dy <= 1; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      const here = floorLevel(vision, y * width + x);
      if (here > level) level = here;
    }
  }
  return level;
}

/**
 * 인스턴스마다의 단계를 다시 계산해 바뀐 것만 알려 준다.
 * @param {Uint8Array} levels 인스턴스별 현재 단계(제자리에서 갱신된다)
 * @param {Int32Array|number[]} cells 인스턴스 → 칸 번호
 * @param {(cell:number) => number} levelOf
 * @param {(index:number, level:number) => void} onChange
 * @returns {number} 바뀐 인스턴스 수
 */
export function updateLevels(levels, cells, levelOf, onChange) {
  let changed = 0;
  for (let i = 0; i < cells.length; i++) {
    const level = levelOf(cells[i]);
    if (level === levels[i]) continue;
    levels[i] = level;
    onChange(i, level);
    changed++;
  }
  return changed;
}
