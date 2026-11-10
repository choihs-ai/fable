// 로직 계층의 최상단. 상태와 이벤트버스를 묶고, 한 틱 동안 각 모듈 시스템을 정해진 순서로 실행한다.
// 로직 모듈(world/entities/combat/items)은 서로를 이 파일을 통해서만 조율한다.

import { EventBus } from './core/event-bus.js';
import { EVENTS } from './core/events.js';
import { PHASE, createInitialState } from './core/state.js';

const PHASE_VALUES = new Set(Object.values(PHASE));

/**
 * @param {{ seed: string|number, bus?: EventBus }} options
 * @returns {{ state: object, bus: EventBus }}
 */
export function createGame({ seed, bus = new EventBus() }) {
  return { state: createInitialState({ seed }), bus };
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
 * 로직을 한 틱 전진시킨다. PLAYING 이 아닐 때는 아무것도 하지 않는다.
 * @param {{ state: object, bus: EventBus }} game
 * @param {number} dtSec 고정 틱 길이(초). 아직 쓰는 시스템이 없다.
 */
export function tick(game, dtSec) {
  const { state } = game;
  if (state.phase !== PHASE.PLAYING) return;
  state.tick += 1;
  // TODO(이후 단계): 입력 커맨드 처리 → entities → combat → items 순으로 시스템 실행.
}
