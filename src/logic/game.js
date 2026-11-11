// 로직 계층의 최상단. 상태와 이벤트버스를 묶고, 한 틱 동안 각 모듈 시스템을 정해진 순서로 실행한다.
// 로직 모듈(world/entities/combat/items)은 서로를 이 파일을 통해서만 조율한다.

import { CHARACTERS } from '../../data/characters.js';
import { EventBus } from './core/event-bus.js';
import { EVENTS } from './core/events.js';
import { PHASE, createInitialState, rngOf } from './core/state.js';
import { resolveDashes, updateActions } from './combat/abilities.js';
import { runAI } from './combat/ai/brain.js';
import { processDeaths } from './combat/deaths.js';
import { updateEncounter } from './combat/encounter.js';
import { updateHazards } from './combat/hazards.js';
import { collectDrops } from './combat/loot.js';
import { controlPlayer } from './combat/player.js';
import { updateProjectiles } from './combat/projectiles.js';
import { updateStatuses } from './combat/statuses.js';
import { getPlayer, populateFloor } from './entities/actors.js';
import { integrateMovement } from './entities/movement.js';
import { refreshPlayerStats } from './entities/stats.js';
import { createMeta, metaBonuses, normalizeMeta, settleRun } from './items/meta.js';
import { rollShopStock } from './items/shop.js';
import { extractCore } from './save/salvage.js';
import { generateFloorFromRng } from './world/generate.js';

const PHASE_VALUES = new Set(Object.values(PHASE));

/**
 * 새 런을 시작한다.
 * @param {object} options
 * @param {string|number} options.seed 런 시드
 * @param {object} [options.meta] 메타 진행(이전 런들에서 쌓인 영혼석·강화·해금). 생략하면 빈 메타
 * @param {string} [options.character] 캐릭터(data/characters.js). 해금하지 않은 캐릭터면 기본 캐릭터로 시작한다
 * @param {EventBus} [options.bus]
 * @returns {{ state: object, bus: EventBus }}
 */
export function createGame({ seed, meta, character = 'knight', bus = new EventBus() }) {
  const state = createInitialState({ seed });
  state.meta = meta ? normalizeMeta(meta) : createMeta();
  state.run.character = Object.hasOwn(CHARACTERS, character) && state.meta.characters[character] === true ? character : 'knight';
  const bonus = metaBonuses(state.meta);
  state.run.gold = bonus.gold;
  state.run.freeRerolls = bonus.freeRerolls;
  return { state, bus };
}

/**
 * 런을 끝내고 메타에 정산한다(영혼석, 기록). 한 런에 한 번만 정산된다.
 * @param {boolean} victory 마지막 층의 출구 포털로 나가 끝났는가
 */
export function endRun(game, victory) {
  const { state, bus } = game;
  if (state.run.ended) return;
  state.run.ended = true;
  const run = state.run;
  const summary = { floor: run.floor, kills: run.kills, eliteKills: run.eliteKills, bossKills: run.bossKills, roomsCleared: run.roomsCleared, victory };
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
 * 맵은 (런 시드, 층 번호)만으로 결정되므로 같은 층에 다시 들어가도 같은 맵이 나온다(방의 진행은 처음으로 돌아간다).
 * @param {{ state: object, bus: EventBus }} game
 * @param {number} floor
 */
export function enterFloor(game, floor) {
  const { state, bus } = game;
  const map = generateFloorFromRng(rngOf(state, 'world'), floor);
  state.run.floor = floor;
  state.run.depth = 0;
  state.world = map;
  // 플레이어는 층을 넘어가도 유지되고(체력·무기·축복 포함), 적·투사체·장판·전리품은 비운다.
  populateFloor(state, bus, map);
  refreshPlayerStats(state);
  // 상점의 진열품은 (런 시드, 층)으로 정해진다.
  const player = getPlayer(state);
  state.shop = {
    stock: rollShopStock(rngOf(state, 'items').fork(`shop:${floor}`), state.run.boons, player.kit.weapons.filter(Boolean)),
    rerolls: 0,
    heals: 0,
  };
  // 시작 방과 거기서 나가는 복도는 처음부터 드러나 있다.
  updateEncounter(state, bus);
  bus.emit(EVENTS.FLOOR_ENTERED, { floor, zoneId: map.zoneId, kind: map.kind });
}

/**
 * 건져 낸 핵심(logic/save/salvage.js 의 extractCore)으로 런을 다시 차린다: 시드·캐릭터·무기·축복·금화는 그대로 두고,
 * 그 층을 시드에서 다시 만들어 층의 처음부터 시작한다(방의 진행은 처음으로 돌아간다).
 */
function rebuildGame(core, meta, bus) {
  const game = createGame({ seed: core.seed, meta, character: core.run.character, bus });
  const { state } = game;
  state.tick = core.tick;
  // 난수 스트림의 키는 시드에서 다시 만든 것을 쓰고, 수열 위치만 세이브에서 가져온다.
  if (core.rng) {
    for (const name of Object.keys(state.rng)) state.rng[name].s = [...core.rng[name]];
  }
  // 캐릭터는 createGame 이 메타에 비춰 정한 것을 쓴다(해금이 사라졌으면 기본 캐릭터).
  Object.assign(state.run, core.run, { character: state.run.character, choice: null, depth: 0 });
  state.entities.nextId = core.nextId;
  enterFloor(game, core.run.floor);
  const player = getPlayer(state);
  if (core.kit) {
    player.kit.weapons = [...core.kit.weapons];
    player.kit.slot = core.kit.slot;
    player.kit.energy = Math.min(player.kit.maxEnergy, core.kit.energy);
  }
  if (core.hp !== null) player.hp = Math.max(1, Math.min(player.maxHp, core.hp));
  setPhase(game, PHASE.PAUSED);
  return game;
}

/**
 * 세이브에서 읽은 런(logic/save/codec.js 의 readRun 결과)으로 게임을 만든다.
 * - 'exact': 저장한 순간의 상태 그대로 이어한다(페이즈도 저장한 그대로).
 * - 'salvage': 핵심만 건진 경우. 그 층을 다시 만들고 PAUSED 로 둔다.
 * @param {object} options
 * @param {object} options.run readRun 의 결과
 * @param {object} [options.meta] 메타 진행(메타 세이브에서 읽은 것)
 * @param {EventBus} [options.bus]
 * @returns {{ game:{ state:object, bus:EventBus }, mode:'exact'|'rebuilt' } | null} 이어할 런이 없으면 null
 */
export function resumeGame({ run, meta, bus = new EventBus() }) {
  let game;
  let mode;
  if (run.status === 'exact') {
    const { state } = run;
    state.meta = meta ? normalizeMeta(meta) : createMeta();
    game = { state, bus };
    // 능력치는 저장된 값을 믿지 않고 다시 계산한다(메타가 달라졌을 수도 있다).
    refreshPlayerStats(state);
    mode = 'exact';
  } else if (run.status === 'salvage') {
    game = rebuildGame(run.core, meta, bus);
    mode = 'rebuilt';
  } else {
    return null;
  }
  bus.emit(EVENTS.GAME_RESTORED, { mode, floor: game.state.run.floor });
  return { game, mode };
}

/**
 * 실행 중이던 게임이 더는 돌릴 수 없게 됐을 때(틱이 예외를 던졌을 때) 핵심만 건져 그 층을 다시 차린다.
 * 같은 이벤트버스를 이어 쓴다.
 * @returns {{ state:object, bus:EventBus } | null} 건질 수 없으면 null(새 런을 시작해야 한다)
 */
export function rescueGame(game) {
  const extracted = extractCore(game.state);
  if (!extracted.ok || game.state.run.ended === true) return null;
  const rebuilt = rebuildGame(extracted.core, game.state.meta, game.bus);
  game.bus.emit(EVENTS.GAME_RESTORED, { mode: 'rebuilt', floor: rebuilt.state.run.floor });
  return rebuilt;
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
  controlPlayer(state, bus); //    2) 입력 → 플레이어 이동 의도, 대시·스킬·무기 공격 시작
  runAI(state, bus); //            3) 적: 이동 의도, 기술 시작
  updateActions(state, bus); //    4) 준비가 끝난 기술 발동, 경직 종료
  integrateMovement(state, dtSec); // 5) 이동·돌진·넉백, 벽 충돌, 서로 밀어내기
  resolveDashes(state, bus); //    6) 돌진 명중과 뒷처리
  updateProjectiles(state, bus, dtSec); // 7) 투사체
  updateHazards(state, bus); //    8) 장판
  const deaths = processDeaths(state, bus); //  9) 죽음 처리: 사망 효과, 처치 보상, 되살아남
  updateEncounter(state, bus); //  10) 방 전투: 문 잠금, 웨이브, 방 깨기와 보상, 방 공개
  collectDrops(state, bus); //    11) 바닥의 것 줍기
  if (deaths.playerDied) endRun(game, false);
}
