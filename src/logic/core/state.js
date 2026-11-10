// 게임 상태 구조. 상태는 JSON 으로 그대로 직렬화되는 평범한 객체다
// (클래스 인스턴스·함수·Map/Set·순환 참조 금지). 로직만 상태를 변경하고 render/ui/audio 는 읽기만 한다.

import { Rng } from './prng.js';

/** 상태 스키마 버전. 구조를 바꾸면 올리고 logic/save 에 마이그레이션을 추가한다. */
export const STATE_VERSION = 4;

export const PHASE = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
  /** 최종보스를 잡고 런을 끝냈다. */
  VICTORY: 'victory',
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
    /** 이번 런의 진행. 레벨·강화는 logic/items/levelup.js, 능력치 합산은 logic/items/stats.js 참고. */
    run: {
      floor: 1,
      level: 1,
      xp: 0,
      /** 아직 고르지 않은 레벨업 선택의 수와, 지금 제시된 후보({ options }) 또는 null. */
      pendingChoices: 0,
      choice: null,
      /** 강화 id → 단계. */
      upgrades: {},
      /** 영구 효과(제단의 축복·저주, 채움 보상): { source, stats }. */
      boons: [],
      /** 지속 중인 물약 효과: { id, stats, until }. */
      buffs: [],
      kills: 0,
      bossKills: 0,
      reviveUsed: false,
      /** 체력 재생의 나머지(10 이 모이면 체력 1). */
      regenPool: 0,
      /** 마지막으로 합산한 능력치(ui 표시용). */
      sheet: null,
      /** 런이 끝나 메타 정산을 마쳤는가. */
      ended: false,
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
    /** 인벤토리(logic/items/inventory.js). createGame 이 채운다. */
    inventory: null,
    /** 바닥에 놓인 전리품: { id, x, y, loot }. */
    drops: [],
    /** 이 층의 상점({ floor, stock, x, y })과 제단({ floor, used, offers, x, y }). 없으면 null. */
    shop: null,
    altar: null,
    /** 메타 진행(logic/items/meta.js). createGame 이 채운다. 저장 단계에서 런과 따로 보관한다. */
    meta: null,
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
