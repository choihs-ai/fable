// 플레이어 시야. 렌더의 안개(fog of war)가 읽는 자료를 state.vision 에 유지한다.
//   visible[i]  지금 보이는 칸이면 1
//   explored[i] 이번 층에서 한 번이라도 본 칸이면 1
// 플레이어가 다른 칸으로 넘어갔을 때만 다시 계산한다.

import { COMBAT } from '../../../data/combat.js';
import { computeFov } from '../world/fov.js';
import { navOf } from '../world/nav.js';
import { getPlayer } from './actors.js';

/** 새 층에 들어갈 때 호출한다. */
export function resetVision(state) {
  const size = state.world.width * state.world.height;
  state.vision = {
    radius: COMBAT.visionRadius,
    /** 마지막으로 계산한 관찰자 칸. -1 이면 아직 계산 전. */
    tile: -1,
    visible: new Array(size).fill(0),
    explored: new Array(size).fill(0),
  };
  updateVision(state);
}

export function updateVision(state) {
  const player = getPlayer(state);
  const vision = state.vision;
  if (!player || !vision) return;
  const nav = navOf(state.world);
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  const tile = ty * nav.w + tx;
  if (tile === vision.tile) return;
  vision.tile = tile;
  computeFov(nav, tx, ty, vision.radius, vision.visible);
  const { visible, explored } = vision;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] === 1) explored[i] = 1;
  }
}

/** 행동체가 지금 플레이어 시야 안에 있는가(렌더가 안개 속 적을 숨길 때 쓴다). */
export function isVisible(state, x, y) {
  const vision = state.vision;
  if (!vision) return false;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return false;
  return vision.visible[ty * state.world.width + tx] === 1;
}
