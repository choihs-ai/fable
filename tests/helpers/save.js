// 세이브 테스트용 도우미: 플레이 중인 게임 표본, 구버전 상태, 저장소 흉내를 거친 "앱 시작" 흐름.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventBus } from '../../src/logic/core/event-bus.js';
import { PHASE } from '../../src/logic/core/state.js';
import { createGame, enterFloor, resumeGame, setPhase } from '../../src/logic/game.js';
import { encodeEnvelope } from '../../src/logic/save/envelope.js';
import { serializeRun } from '../../src/logic/save/codec.js';
import { createSaveStore } from '../../src/save/save-store.js';
import { openStorage } from '../../src/save/storage.js';
import { Rng, cloneGame, createFakeStorage, floorGames, play } from '../../scripts/lib/save-sim.js';

const cache = new Map();

/**
 * 전투 중인 게임 하나(사본). 같은 인자면 같은 상태다.
 * 기본 표본(9층)은 가방·착용 장비·유물·금화가 있고 적 여럿과 싸우는 중이다.
 */
export function sampleGame({ seed = 'save-sample', floor = 9, ticks = 300, meta } = {}) {
  const key = `${seed}|${floor}|${ticks}|${JSON.stringify(meta ?? null)}`;
  if (!cache.has(key)) {
    const [{ game }] = floorGames({ seed, meta, floors: (f) => f === floor });
    play(game, Rng.fromSeed(`sample:${key}`), ticks);
    if (game.state.phase !== PHASE.PLAYING) throw new Error(`표본이 플레이 중이 아님: ${key}`);
    cache.set(key, game);
  }
  return cloneGame(cache.get(key));
}

/** 표본의 세이브 글과 본문. */
export function sampleSave(options) {
  const game = sampleGame(options);
  const saved = serializeRun(game.state, 1000);
  if (!saved.ok) throw new Error(`표본을 저장하지 못함: ${JSON.stringify(saved)}`);
  return { game, text: saved.text, data: JSON.parse(saved.text).data };
}

/** 옛 버전의 실제 코드가 만든 상태(tests/fixtures, scripts/make-old-saves.mjs 로 만든다)를 그 버전의 세이브 글로 감싼다. */
export function oldSave(version) {
  const path = fileURLToPath(new URL(`../fixtures/state-v${version}.json`, import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return { data, text: encodeEnvelope({ kind: 'run', version, data: structuredClone(data), savedAt: 1 }) };
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

export { Rng, cloneGame, createFakeStorage, play };
