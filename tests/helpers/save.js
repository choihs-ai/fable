// 세이브 테스트용 도우미: 플레이 중인 게임 표본, 구버전 상태, 저장소 흉내를 거친 "앱 시작" 흐름.

import { EventBus } from '../../src/logic/core/event-bus.js';
import { PHASE } from '../../src/logic/core/state.js';
import { createGame, enterFloor, resumeGame, setPhase } from '../../src/logic/game.js';
import { encodeEnvelope } from '../../src/logic/save/envelope.js';
import { serializeRun } from '../../src/logic/save/codec.js';
import { createSaveStore } from '../../src/save/save-store.js';
import { openStorage } from '../../src/save/storage.js';
import { Rng, cloneGame, combatGame, createFakeStorage, play, stageGames } from '../../scripts/lib/save-sim.js';

const cache = new Map();

/**
 * 방 전투가 한창인 게임 하나(사본). 같은 인자면 같은 상태다.
 * 적 여럿이 살아 있고, 문이 잠겨 있고, 무기 둘과 금화·(대개) 축복이 있다.
 */
export function sampleGame({ seed = 'save-sample', minTick = 1500, meta, character } = {}) {
  const key = `${seed}|${minTick}|${character ?? ''}|${JSON.stringify(meta ?? null)}`;
  if (!cache.has(key)) cache.set(key, combatGame({ seed, meta, character, minTick }));
  return cloneGame(cache.get(key));
}

/** 표본의 세이브 글과 본문. */
export function sampleSave(options) {
  const game = sampleGame(options);
  const saved = serializeRun(game.state, 1000);
  if (!saved.ok) throw new Error(`표본을 저장하지 못함: ${JSON.stringify(saved)}`);
  return { game, text: saved.text, data: JSON.parse(saved.text).data };
}

/** 방 단위 구조로 바꾸기 전(버전 1~4)의 런 세이브 흉내: 그 버전의 봉투에 옛 구조의 본문을 담는다. */
export function oldSave(version) {
  const data = {
    version, seed: 'old-run', tick: 4321, phase: 'playing',
    run: { floor: 7, level: 5, xp: 40, kills: 31, bossKills: 1, ended: false },
    world: null, entities: { nextId: 5, byId: {} }, playerId: null,
    inventory: { capacity: 20, bag: [], equipped: {}, consumables: { health_potion: 2 }, relics: ['whetstone'], gold: 120 },
  };
  return { data, text: encodeEnvelope({ kind: 'run', version, data: structuredClone(data), savedAt: 1 }) };
}

/** 메타 버전 1(방 단위 구조 이전)의 메타 세이브. 그 시절의 createMeta·serializeMeta 가 쓰던 모양 그대로다. */
export function oldMetaSave(overrides = {}) {
  const data = { version: 1, souls: 137, unlocked: { vigor_1: true, purse_1: true, relic_pack: true }, runs: 9, victories: 1, bestFloor: 30, totalKills: 412, ...overrides };
  return { data, text: encodeEnvelope({ kind: 'meta', version: 1, data: structuredClone(data), savedAt: 1 }) };
}

/**
 * 앱을 시작하는 흐름(main.js 와 같은 순서): 저장소를 열고, 읽고, 이어하거나 새 런을 시작한다.
 * @param {object} backend createFakeStorage 로 만든 저장소(또는 그런 모양의 객체)
 * @returns {{ game:object, store:object, loaded:object, how:'exact'|'rebuilt'|'new' }}
 */
export function boot(backend, { seed = 'boot-seed' } = {}) {
  const store = createSaveStore({ storage: openStorage(() => backend), now: () => 2000 });
  const loaded = store.load();
  const bus = new EventBus();
  const resumed = resumeGame({ run: loaded.run.result, meta: loaded.meta.meta, bus });
  let game;
  let how;
  if (resumed) {
    game = resumed.game;
    how = resumed.mode;
  } else {
    game = createGame({ seed, meta: loaded.meta.meta, bus });
    enterFloor(game, 1);
    how = 'new';
  }
  setPhase(game, PHASE.PLAYING);
  return { game, store, loaded, how };
}

export { Rng, cloneGame, createFakeStorage, play, stageGames };
