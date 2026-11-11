// 순차 마이그레이션: 옛 버전의 세이브 본문을 한 버전씩 올려 현재 버전으로 만든다.
// MIGRATIONS[종류][n] 은 버전 n 의 본문을 받아 n+1 의 본문을 돌려준다. 구조를 바꿔 버전을 올리면 여기에 한 단계를 추가한다
// (건너뛰는 단계가 있으면 그 버전의 세이브는 읽지 못한다 — tests/logic/save/migrate.test.js 가 빠진 단계를 잡는다).
//
// 마이그레이션은 검증보다 먼저 돈다. 받은 값이 손상돼 있을 수 있으므로 모양이 맞을 때만 고치고, 판단은 검증기에 맡긴다.

import { META_VERSION } from '../../../data/meta.js';
import { SETTINGS_VERSION } from '../../../data/settings.js';
import { PHASE, STATE_VERSION } from '../core/state.js';
import { createInventory } from '../items/inventory.js';
import { isObject } from './schema.js';

/** 종류별 현재 버전. 런은 상태 구조의 버전(STATE_VERSION)을 그대로 쓴다. */
export const CURRENT_VERSION = Object.freeze({ run: STATE_VERSION, meta: META_VERSION, settings: SETTINGS_VERSION });

/** 없는 필드만 채운다. */
function fill(target, defaults) {
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(target, key)) target[key] = defaults[key];
  }
}

const RUN_MIGRATIONS = {
  // v1(0단계: 뼈대) → v2(1단계: 맵 생성). 구조는 같고 world 에 맵이 들어가기 시작했다.
  1(state) {
    fill(state, { world: null });
    return state;
  },
  // v2 → v3(2단계: 엔티티와 전투). 투사체·장판·시야·입력이 생겼다.
  // v2 에는 플레이어·적이 없었다(맵만 있었다). 그 맵에 몸을 채울 방법이 없으므로 맵을 비워, 불러올 때 층을 다시 만들게 한다
  // (맵은 시드와 층만으로 정해지므로 같은 층이 다시 만들어진다. 다만 3단계에서 적 배치 수가 바뀌어 적 배치는 다르다).
  2(state) {
    if (isObject(state.entities) && isObject(state.entities.byId) && Object.keys(state.entities.byId).length === 0) state.world = null;
    fill(state, {
      projectiles: [],
      hazards: [],
      vision: null,
      input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, skill: -1, dodge: false },
    });
    return state;
  },
  // v3 → v4(3단계: 아이템과 성장). 런 진행도·인벤토리·전리품·상점·제단이 생기고,
  // 행동체·투사체·장판에 공격 배율 등이 붙었다. v3 의 적은 층별 난이도 배율 없이 만들어졌으므로 배율 1 로 둔다.
  3(state) {
    if (isObject(state.run)) {
      fill(state.run, {
        level: 1, xp: 0, pendingChoices: 0, choice: null, upgrades: {}, boons: [], buffs: [], kills: 0, bossKills: 0,
        reviveUsed: false, regenPool: 0, sheet: null, ended: state.phase === PHASE.GAME_OVER,
      });
    }
    fill(state, { inventory: createInventory(), drops: [], shop: null, altar: null });
    if (isObject(state.entities) && isObject(state.entities.byId)) {
      for (const key of Object.keys(state.entities.byId)) {
        const actor = state.entities.byId[key];
        if (isObject(actor)) fill(actor, { power: 1, critChance: 0, critDamage: 1.5, lifesteal: 0, haste: 0, regen: 0, onHit: null });
      }
    }
    for (const listName of ['projectiles', 'hazards']) {
      if (!Array.isArray(state[listName])) continue;
      for (const entry of state[listName]) {
        if (isObject(entry)) fill(entry, { power: 1 });
      }
    }
    return state;
  },
};

const SETTINGS_MIGRATIONS = {
  // v1 → v2(5단계): 조이스틱 감도가 생겼다.
  1(settings) {
    fill(settings, { sensitivity: 100 });
    return settings;
  },
};

export const MIGRATIONS = Object.freeze({ run: RUN_MIGRATIONS, meta: {}, settings: SETTINGS_MIGRATIONS });

/**
 * 본문을 version 에서 target 버전까지 한 단계씩 올린다. 받은 본문을 직접 고친다(세이브에서 막 읽은 값이므로).
 * @param {string} kind 'run' | 'meta' | 'settings'
 * @param {object} data 본문
 * @param {number} version 본문의 버전
 * @param {{ table?:object, target?:number }} [options] 테스트에서 표와 목표 버전을 바꿔 끼울 수 있다
 * @returns {{ ok:true, data:object, steps:number[] } | { ok:false, reason:string, detail?:string }}
 *   reason: 'newer-version'(이 프로그램보다 새 버전) | 'no-migration'(단계가 빠짐) | 'migration-failed'(단계가 예외를 던짐)
 */
export function migrate(kind, data, version, options = {}) {
  const table = options.table ?? MIGRATIONS[kind];
  const target = options.target ?? CURRENT_VERSION[kind];
  if (!table || !Number.isInteger(target)) throw new RangeError(`migrate: 알 수 없는 종류 "${kind}"`);
  if (!Number.isInteger(version) || version < 1) throw new RangeError(`migrate: 버전이 올바르지 않습니다 (${version})`);
  if (version > target) return { ok: false, reason: 'newer-version' };
  let current = data;
  const steps = [];
  for (let v = version; v < target; v++) {
    const step = Object.hasOwn(table, v) ? table[v] : null;
    if (typeof step !== 'function') return { ok: false, reason: 'no-migration', detail: `v${v} → v${v + 1}` };
    try {
      current = step(current);
    } catch (err) {
      return { ok: false, reason: 'migration-failed', detail: `v${v} → v${v + 1}: ${err && err.message}` };
    }
    if (!isObject(current)) return { ok: false, reason: 'migration-failed', detail: `v${v} → v${v + 1}: 결과가 객체가 아님` };
    if (Object.hasOwn(current, 'version')) current.version = v + 1;
    steps.push(v);
  }
  return { ok: true, data: current, steps };
}
