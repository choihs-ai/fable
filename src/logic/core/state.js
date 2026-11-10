// 게임 상태 구조. 상태는 JSON 으로 그대로 직렬화되는 평범한 객체다
// (클래스 인스턴스·함수·Map/Set·순환 참조 금지). 로직만 상태를 변경하고 render/ui/audio 는 읽기만 한다.

import { Rng } from './prng.js';

/** 상태 스키마 버전. 구조를 바꾸면 올리고 logic/save 에 마이그레이션을 추가한다. */
export const STATE_VERSION = 3;

export const PHASE = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
});

/**
 * 루트 시드에서 갈라지는 서브스트림 이름. 모듈마다 자기 스트림만 쓴다.
 * 스트림을 추가해도 기존 스트림의 수열은 바뀌지 않는다.
 */
export const RNG_STREAMS = Object.freeze(['world', 'entities', 'combat', 'items']);

/**
 * @param {{ seed: string|number }} options
 */
export function createInitialState({ seed }) {
  const root = Rng.fromSeed(seed);
  const rng = {};
  for (const name of RNG_STREAMS) rng[name] = root.fork(name).data;

  return {
    version: STATE_VERSION,
    seed: String(seed),
    /** 지금까지 진행된 고정 틱 수. 게임 내 경과 시간 = tick / tickRate. */
    tick: 0,
    phase: PHASE.TITLE,
    /** 스트림 이름 → PRNG 상태({ key, s }). rngOf() 로 꺼내 쓴다. */
    rng,
    run: {
      floor: 1,
    },
    /** 현재 층 맵(logic/world/generate.js 의 결과). 층에 들어가기 전에는 null. */
    world: null,
    entities: {
      /** 행동체·투사체·장판이 함께 쓰는 일련번호. */
      nextId: 1,
      /** id → 행동체(플레이어·적·보스). 형태는 logic/entities/actors.js 참고. */
      byId: {},
    },
    /** 플레이어 행동체 id. 층에 들어가기 전에는 null. */
    playerId: null,
    /** 날아가는 투사체 목록(logic/combat/projectiles.js). */
    projectiles: [],
    /** 예고 중이거나 남아 있는 장판 목록(logic/combat/hazards.js). */
    hazards: [],
    /** 플레이어 시야(logic/entities/vision.js). 층에 들어가기 전에는 null. */
    vision: null,
    /**
     * 이번 틱의 플레이어 입력. ui 가 setInput 으로 채우고 로직이 읽는다.
     * move/aim 은 방향 벡터(aim 이 0 이면 자동 조준), skill 은 기술 칸 번호(-1 = 없음).
     * skill 과 dodge 는 한 번 처리되면 로직이 지운다.
     */
    input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, skill: -1, dodge: false },
  };
}

/**
 * 상태에 들어 있는 서브스트림을 Rng 로 꺼낸다. 난수를 뽑으면 state.rng 가 제자리에서 갱신된다.
 * @param {object} state
 * @param {string} stream RNG_STREAMS 중 하나
 */
export function rngOf(state, stream) {
  const data = state.rng[stream];
  if (!data) throw new RangeError(`rngOf: 알 수 없는 스트림 "${stream}"`);
  return new Rng(data);
}
