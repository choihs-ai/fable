// 로직 계층의 최상단. 상태와 이벤트버스를 묶고, 한 틱 동안 각 모듈 시스템을 정해진 순서로 실행한다.
// 로직 모듈(world/entities/combat/items)은 서로를 이 파일을 통해서만 조율한다.

import { EventBus } from './core/event-bus.js';
import { EVENTS } from './core/events.js';
import { PHASE, createInitialState, rngOf } from './core/state.js';
import { resolveDashes, updateActions } from './combat/abilities.js';
import { runAI } from './combat/ai/brain.js';
import { processDeaths } from './combat/deaths.js';
import { updateHazards } from './combat/hazards.js';
import { applyFloorRelics, collectDrops, setupFloorLoot, updateUpkeep } from './combat/loot.js';
import { controlPlayer } from './combat/player.js';
import { updateProjectiles } from './combat/projectiles.js';
import { updateStatuses } from './combat/statuses.js';
import { populateFloor } from './entities/actors.js';
import { integrateMovement } from './entities/movement.js';
import { refreshPlayerStats } from './entities/stats.js';
import { resetVision, updateVision } from './entities/vision.js';
import { createInventory } from './items/inventory.js';
import { createMeta, normalizeMeta, settleRun, startBonuses } from './items/meta.js';
import { TOTAL_FLOORS } from './world/floors.js';
import { generateFloorFromRng } from './world/generate.js';

const PHASE_VALUES = new Set(Object.values(PHASE));

/**
 * 새 런을 시작한다.
 * @param {object} options
 * @param {string|number} options.seed 런 시드
 * @param {object} [options.meta] 메타 진행(이전 런들에서 쌓인 영혼석·해금). 생략하면 빈 메타
 * @param {EventBus} [options.bus]
 * @returns {{ state: object, bus: EventBus }}
 */
export function createGame({ seed, meta, bus = new EventBus() }) {
  const state = createInitialState({ seed });
  state.meta = meta ? normalizeMeta(meta) : createMeta();
  state.inventory = createInventory(startBonuses(state.meta));
  return { state, bus };
}

/**
 * 런을 끝내고 메타에 정산한다(영혼석, 기록). 한 런에 한 번만 정산된다.
 * @param {boolean} victory 최종보스를 잡고 끝났는가
 */
export function endRun(game, victory) {
  const { state, bus } = game;
  if (state.run.ended) return;
  state.run.ended = true;
  const summary = { floor: state.run.floor, kills: state.run.kills, bossKills: state.run.bossKills, victory };
  const souls = settleRun(state.meta, summary);
  setPhase(game, victory ? PHASE.VICTORY : PHASE.GAME_OVER);
  bus.emit(EVENTS.RUN_ENDED, { ...summary, souls });
}

/** 페이즈를 바꾸고 PHASE_CHANGED 를 발행한다. 같은 페이즈면 아무 일도 하지 않는다. */
export function setPhase(game, phase) {
  if (!PHASE_VALUES.has(phase)) throw new RangeError(`setPhase: 알 수 없는 페이즈 "${phase}"`);
  const from = game.state.phase;
  if (from === phase) return;
  game.state.phase = phase;
  game.bus.emit(EVENTS.PHASE_CHANGED, { from, to: phase });
}

/**
 * 층에 들어간다: 그 층의 맵을 만들어 state.world 에 넣고 FLOOR_ENTERED 를 발행한다.
 * 맵은 (런 시드, 층 번호)만으로 결정되므로 같은 층에 다시 들어가도 같은 맵이 나온다.
 * @param {{ state: object, bus: EventBus }} game
 * @param {number} floor
 */
export function enterFloor(game, floor) {
  const map = generateFloorFromRng(rngOf(game.state, 'world'), floor);
  game.state.run.floor = floor;
  game.state.world = map;
  // 플레이어는 층을 넘어가도 유지되고(체력·재사용 대기 포함), 적·투사체·장판은 새로 만든다.
  populateFloor(game.state, game.bus, map);
  refreshPlayerStats(game.state);
  applyFloorRelics(game.state);
  setupFloorLoot(game.state, game.bus);
  resetVision(game.state);
  game.bus.emit(EVENTS.FLOOR_ENTERED, { floor, zoneId: map.zoneId, kind: map.kind });
}

/**
 * 로직을 한 틱 전진시킨다. PLAYING 이 아닐 때는 아무것도 하지 않는다.
 * @param {{ state: object, bus: EventBus }} game
 * @param {number} dtSec 고정 틱 길이(초)
 */
export function tick(game, dtSec) {
  const { state } = game;
  if (state.phase !== PHASE.PLAYING) return;
  state.tick += 1;
  if (!state.world) return;
  const { bus } = game;
  // 순서가 곧 규칙이다. 바꾸면 같은 시드·같은 입력의 결과가 달라진다.
  updateStatuses(state, bus); //   1) 지속 피해, 만료, 행동 불가·둔화 계산
  controlPlayer(state, bus); //    2) 입력 → 플레이어 이동 의도, 회피·기술 시작
  runAI(state, bus); //            3) 적: 어그로·리쉬, 이동 의도, 기술 시작
  updateActions(state, bus); //    4) 준비가 끝난 기술 발동, 경직 종료
  integrateMovement(state, dtSec); // 5) 이동·돌진, 벽 충돌, 서로 밀어내기
  resolveDashes(state, bus); //    6) 돌진 명중과 뒷처리
  updateProjectiles(state, bus, dtSec); // 7) 투사체
  updateHazards(state, bus); //    8) 장판
  const deaths = processDeaths(state, bus); //  9) 죽음 처리: 사망 효과, 처치 보상, 되살아남
  collectDrops(state, bus); //    10) 바닥의 전리품 줍기
  updateUpkeep(state); //         11) 물약 효과 만료, 체력 재생
  updateVision(state); //         12) 플레이어 시야
  if (deaths.playerDied) endRun(game, false);
  else if (deaths.finalBossDied && state.run.floor === TOTAL_FLOORS) endRun(game, true);
}
