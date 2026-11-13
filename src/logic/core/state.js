// 게임 상태 구조. 상태는 JSON 으로 그대로 직렬화되는 평범한 객체다
// (클래스 인스턴스·함수·Map/Set·순환 참조 금지). 로직만 상태를 변경하고 render/ui/audio 는 읽기만 한다.

import { Rng } from './prng.js';

/**
 * 상태 스키마 버전. 구조를 바꾸면 올리고 logic/save 에 마이그레이션을 추가한다.
 * 5: 방 단위 액션 로그라이트로 바꾸면서 런의 구조가 통째로 달라졌다(4 이하의 런은 이어할 수 없다).
 */
export const STATE_VERSION = 7;

export const PHASE = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
  /** 마지막 층의 출구 포털로 나가 런을 끝냈다. */
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
    /** 이번 런의 진행. */
    run: {
      floor: 1,
      /** 고른 캐릭터(data/characters.js). */
      character: 'knight',
      gold: 0,
      /** 가진 축복의 id(얻은 순서). 효과는 logic/combat/boons.js. */
      boons: [],
      /** 축복이 쓰는 값: 과충전의 공격 횟수, 얼음 갑옷·증기 폭발을 다시 쓸 수 있는 틱, 되살아났는가. */
      boonState: { shots: 0, iceArmorAt: 0, steamAt: 0, revived: false },
      /** 지금 제시된 3택1({ kind:'boon', options:[id…], rerolls }) 또는 null. 제시돼 있는 동안 ui 가 게임을 멈춘다. */
      choice: null,
      /** 이번 런에 남은 무료 다시 뽑기. */
      freeRerolls: 0,
      /** 지금 싸우는 방의 깊이(적의 체력·공격 배율에 쓴다). */
      depth: 0,
      kills: 0,
      eliteKills: 0,
      bossKills: 0,
      roomsCleared: 0,
      /** 런이 끝나 메타 정산을 마쳤는가. */
      ended: false,
    },
    /** 현재 층 맵(logic/world/generate.js 의 결과). 방·문의 상태(잠김, 깼는가, 드러났는가)도 여기에 있다. 층에 들어가기 전에는 null. */
    world: null,
    entities: {
      /** 행동체·투사체·장판·전리품이 함께 쓰는 일련번호. */
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
    /**
     * 진행 중인 방 전투(logic/combat/encounter.js): { room, pending:[{ type, elite, x, y, at }], nextWaveAt } 또는 null.
     * pending 은 예고 중인(곧 나타날) 적.
     */
    encounter: null,
    /**
     * 이번 틱의 플레이어 입력. ui 가 setInput 으로 채우고 로직이 읽는다.
     * move/aim 은 방향 벡터(aim 이 0 이면 자동 조준). dash 와 skill·skill2(탈의 두 스킬)는 한 번 처리되면 로직이 지운다.
     */
    input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false, skill2: false },
    /** 바닥에 놓인 것: { id, kind:'gold'|'energy'|'health'|'weapon'|'boon'|'chest', x, y, amount?, weapon? }. */
    drops: [],
    /** 이 층의 상점: { stock:[{ kind, weapon?, boon?, price, sold }], rerolls, heals } 또는 null. */
    shop: null,
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
