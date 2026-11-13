// 순차 마이그레이션: 옛 버전의 세이브 본문을 한 버전씩 올려 현재 버전으로 만든다.
// MIGRATIONS[종류][n] 은 버전 n 의 본문을 받아 n+1 의 본문을 돌려준다. 구조를 바꿔 버전을 올리면 여기에 한 단계를 추가한다
// (건너뛰는 단계가 있으면 그 버전의 세이브는 읽지 못한다 — tests/logic/save/migrate.test.js 가 빠진 단계를 잡는다).
//
// 마이그레이션은 검증보다 먼저 돈다. 받은 값이 손상돼 있을 수 있으므로 모양이 맞을 때만 고치고, 판단은 검증기에 맡긴다.

import { LEGACY_UNLOCK_COSTS, META_VERSION } from '../../../data/meta.js';
import { SETTINGS_VERSION } from '../../../data/settings.js';
import { STATE_VERSION } from '../core/state.js';
import { isObject } from './schema.js';

/** 종류별 현재 버전. 런은 상태 구조의 버전(STATE_VERSION)을 그대로 쓴다. */
export const CURRENT_VERSION = Object.freeze({ run: STATE_VERSION, meta: META_VERSION, settings: SETTINGS_VERSION });

/**
 * 종류별로 읽을 수 있는 가장 낮은 버전. 이보다 낮은 세이브는 올릴 방법이 없어 버린다('retired-version').
 * 런: 버전 4 이하는 방 단위 구조로 바꾸기 전의 런이다(계단을 내려가는 30층, 장비와 레벨). 지금의 런으로 옮길 수 없다.
 *     그 런의 메타(영혼석)는 메타 세이브에 따로 있어 남는다.
 */
export const MIN_VERSION = Object.freeze({ run: 5, meta: 1, settings: 1 });

/** 없는 필드만 채운다. */
function fill(target, defaults) {
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(target, key)) target[key] = defaults[key];
  }
}

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

const RUN_MIGRATIONS = {
  // v5 → v6(탈 교체): 플레이어의 장비에 무기 칸마다 딸린 탈(forms)이 생겼다. 쓰고 있던 캐릭터를 든 칸의 탈로 둔다.
  5(run) {
    run.version = 6;
    const byId = isObject(run.entities) && isObject(run.entities.byId) ? run.entities.byId : {};
    for (const key of Object.keys(byId)) {
      const actor = byId[key];
      if (!isObject(actor) || !isObject(actor.kit) || Object.hasOwn(actor.kit, 'forms')) continue;
      const forms = [null, null];
      forms[actor.kit.slot === 1 ? 1 : 0] = typeof actor.kit.character === 'string' ? actor.kit.character : null;
      actor.kit.forms = forms;
      fill(actor.kit, { hpDebt: 0, energyDebt: 0 });
      // 스킬의 재사용 대기는 이제 탈마다 따로 센다.
      if (isObject(actor.cooldowns) && Object.hasOwn(actor.cooldowns, 'skill')) {
        if (typeof actor.kit.character === 'string') actor.cooldowns[`skill:${actor.kit.character}`] = actor.cooldowns.skill;
        delete actor.cooldowns.skill;
      }
    }
    return run;
  },
  // v6 → v7(스킬 둘): 입력에 두 번째 스킬(skill2)이 생겼다.
  6(run) {
    run.version = 7;
    if (isObject(run.input)) fill(run.input, { skill2: false });
    return run;
  },
  // v7 → v8(저주): 판에 건 저주 단계(run.curse)가 생겼다. 옛 판은 저주 없이 하던 판이다.
  7(run) {
    run.version = 8;
    if (isObject(run.run)) fill(run.run, { curse: 0 });
    return run;
  },
};

const META_MIGRATIONS = {
  // v1 → v2(방 단위 구조): 영구 해금(장비 세트·유물 등)이 사라지고 영구 강화와 캐릭터 해금이 생겼다.
  // 영혼석과 기록은 그대로 가져오고, 사 두었던 옛 해금은 그 값만큼 영혼석으로 돌려준다.
  1(meta) {
    let souls = count(meta.souls);
    if (isObject(meta.unlocked)) {
      for (const id of Object.keys(meta.unlocked)) {
        if (Object.hasOwn(LEGACY_UNLOCK_COSTS, id) && meta.unlocked[id] === true) souls += LEGACY_UNLOCK_COSTS[id];
      }
    }
    return {
      version: 2, souls, upgrades: {}, characters: {}, runs: count(meta.runs), victories: count(meta.victories), bestRooms: 0, totalKills: count(meta.totalKills),
    };
  },
};

// v2 → v3(저주): 고른 저주 단계와 열린 단계가 생겼다.
META_MIGRATIONS[2] = (meta) => {
  meta.version = 3;
  fill(meta, { curse: 0, curseMax: 0 });
  return meta;
};

const SETTINGS_MIGRATIONS = {
  // v1 → v2(5단계): 조이스틱 감도가 생겼다.
  1(settings) {
    fill(settings, { sensitivity: 100 });
    return settings;
  },
};

export const MIGRATIONS = Object.freeze({ run: RUN_MIGRATIONS, meta: META_MIGRATIONS, settings: SETTINGS_MIGRATIONS });

/**
 * 본문을 version 에서 target 버전까지 한 단계씩 올린다. 받은 본문을 직접 고친다(세이브에서 막 읽은 값이므로).
 * @param {string} kind 'run' | 'meta' | 'settings'
 * @param {object} data 본문
 * @param {number} version 본문의 버전
 * @param {{ table?:object, target?:number, min?:number }} [options] 테스트에서 표와 목표·최저 버전을 바꿔 끼울 수 있다
 * @returns {{ ok:true, data:object, steps:number[] } | { ok:false, reason:string, detail?:string }}
 *   reason: 'newer-version'(이 프로그램보다 새 버전) | 'retired-version'(올릴 방법이 없는 옛 버전) | 'no-migration'(단계가 빠짐)
 *           | 'migration-failed'(단계가 예외를 던짐)
 */
export function migrate(kind, data, version, options = {}) {
  const table = options.table ?? MIGRATIONS[kind];
  const target = options.target ?? CURRENT_VERSION[kind];
  if (!table || !Number.isInteger(target)) throw new RangeError(`migrate: 알 수 없는 종류 "${kind}"`);
  if (!Number.isInteger(version) || version < 1) throw new RangeError(`migrate: 버전이 올바르지 않습니다 (${version})`);
  if (version > target) return { ok: false, reason: 'newer-version' };
  const min = options.min ?? (options.table ? 1 : MIN_VERSION[kind]);
  if (version < min) return { ok: false, reason: 'retired-version', detail: `v${version} (읽을 수 있는 가장 낮은 버전: v${min})` };
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
