// 세이브를 글로 쓰고(serialize*) 읽는다(read*). 읽기는 어떤 값을 받아도 예외를 던지지 않고 결과로 알린다.
// 저장소(localStorage 등)는 여기서 모른다 — 글을 주고받을 뿐이다(src/save 가 저장소를 다룬다).

import { META_VERSION } from '../../../data/meta.js';
import { SAVE } from '../../../data/save.js';
import { SETTINGS_VERSION } from '../../../data/settings.js';
import { PHASE, STATE_VERSION } from '../core/state.js';
import { normalizeMeta } from '../items/meta.js';
import { decodeEnvelope, encodeEnvelope } from './envelope.js';
import { migrate } from './migrate.js';
import { extractCore } from './salvage.js';
import { isObject } from './schema.js';
import { normalizeSettings } from './settings.js';
import { RESUMABLE_PHASES, validateRunCore, validateRunState } from './validate.js';

const FINISHED_PHASES = [PHASE.GAME_OVER, PHASE.VICTORY];

/**
 * 런을 글로 쓴다. 검증을 통과한 상태만 쓴다 — 읽을 수 없는 세이브로 멀쩡한 세이브를 덮어쓰지 않기 위해서다.
 * 메타(state.meta)는 넣지 않는다(따로 저장한다).
 * @param {object} state
 * @param {number} [savedAt] 저장 시각(ms). 바깥에서 받는다
 * @returns {{ ok:true, text:string } | { ok:false, reason:string, problems?:string[] }}
 *   reason: 'run-ended'(끝난 런) | 'not-started'(아직 층에 들어가지 않음) | 'invalid-state'(검증 실패, problems 참고)
 */
export function serializeRun(state, savedAt = 0) {
  if (!isObject(state) || !isObject(state.run)) return { ok: false, reason: 'invalid-state', problems: ['state: 객체가 아님'] };
  if (state.run.ended === true || FINISHED_PHASES.includes(state.phase)) return { ok: false, reason: 'run-ended' };
  if (state.world === null || !RESUMABLE_PHASES.includes(state.phase)) return { ok: false, reason: 'not-started' };
  const problems = validateRunState(state);
  if (problems.length > 0) return { ok: false, reason: 'invalid-state', problems };
  const data = {};
  for (const key of Object.keys(state)) {
    if (key !== 'meta') data[key] = state[key];
  }
  return { ok: true, text: encodeEnvelope({ kind: 'run', version: STATE_VERSION, data, savedAt }) };
}

/**
 * 런 세이브를 읽는다.
 * @param {*} text 저장소에서 읽은 값
 * @returns {object} status 에 따라:
 *   'exact'    { state, version, savedAt, migrated }          — 저장한 그대로 이어할 수 있다(state.meta 는 비어 있다)
 *   'salvage'  { core, damaged, repaired, problems, checksumOk, version, savedAt, migrated } — 핵심만 건졌다. 층은 다시 만들어야 한다.
 *              damaged 가 false 면 손상이 아니라 옛 버전에서 올라와 층이 없는 정상 세이브다(problems 는 비어 있다)
 *   'finished' { version, savedAt }                            — 끝난 런이다. 이어할 것이 없다
 *   'none'     { reason, detail?, problems? }                  — 쓸 수 없다. reason 은 decodeEnvelope 의 것 또는
 *              'newer-version' | 'retired-version'(방 단위 구조 이전의 런) | 'no-migration' | 'migration-failed' | 'unrecoverable'
 */
export function readRun(text) {
  const envelope = decodeEnvelope(text, 'run');
  if (!envelope.ok) return { status: 'none', reason: envelope.reason };
  const { version, savedAt, checksumOk } = envelope;
  const moved = migrate('run', envelope.data, version);
  if (!moved.ok) return { status: 'none', reason: moved.reason, detail: moved.detail };
  const { data } = moved;
  const migrated = moved.steps;

  if (isObject(data.run) && (data.run.ended === true || FINISHED_PHASES.includes(data.phase))) return { status: 'finished', version, savedAt };

  let problems = validateRunState(data);
  if (problems.length === 0 && !RESUMABLE_PHASES.includes(data.phase)) problems = [`phase: 이어할 수 없는 페이즈 (${data.phase})`];
  if (problems.length === 0 && checksumOk) {
    delete data.meta; // 메타는 메타 세이브에서 온다.
    return { status: 'exact', state: data, version, savedAt, migrated };
  }
  // 옛 버전에서 올라온 세이브에 층이 없는 경우: 핵심만 온전하면 손상이 아니다(지금은 그런 버전이 없지만 길은 남겨 둔다).
  const needsFloorOnly = checksumOk && migrated.length > 0 && data.world === null && validateRunCore(data).length === 0;
  if (needsFloorOnly) problems = [];
  if (!checksumOk) problems = ['checksum: 본문이 저장한 것과 다름', ...problems];
  const extracted = extractCore(data);
  if (!extracted.ok) return { status: 'none', reason: 'unrecoverable', detail: extracted.reason, problems };
  return {
    status: 'salvage', core: extracted.core, damaged: !needsFloorOnly, repaired: extracted.repaired, problems, checksumOk, version, savedAt, migrated,
  };
}

/** 메타 진행을 글로 쓴다. */
export function serializeMeta(meta, savedAt = 0) {
  return encodeEnvelope({ kind: 'meta', version: META_VERSION, data: normalizeMeta(meta), savedAt });
}

/** 메타의 수치를 안전선 안으로 자른다. */
function capMeta(meta) {
  for (const key of ['souls', 'runs', 'victories', 'bestRooms', 'totalKills']) meta[key] = Math.min(meta[key], SAVE.limits.gold);
  return meta;
}

/**
 * 메타 세이브를 읽는다. 항목마다 따로 검사해서 올바른 것만 받는다(틀린 항목은 0, 모르는 강화·캐릭터는 버림).
 * @returns {{ ok:true, meta:object, repaired:boolean, checksumOk:boolean, version:number, savedAt:number } | { ok:false, reason:string }}
 */
export function readMeta(text) {
  const envelope = decodeEnvelope(text, 'meta');
  if (!envelope.ok) return { ok: false, reason: envelope.reason };
  const moved = migrate('meta', envelope.data, envelope.version);
  if (!moved.ok) return { ok: false, reason: moved.reason };
  const meta = capMeta(normalizeMeta(moved.data));
  const repaired = JSON.stringify(meta) !== JSON.stringify(moved.data);
  return { ok: true, meta, repaired, checksumOk: envelope.checksumOk, version: envelope.version, savedAt: envelope.savedAt };
}

/** 설정을 글로 쓴다. */
export function serializeSettings(settings, savedAt = 0) {
  return encodeEnvelope({ kind: 'settings', version: SETTINGS_VERSION, data: normalizeSettings(settings).settings, savedAt });
}

/**
 * 설정 세이브를 읽는다. 읽지 못하면 기본값을 돌려준다.
 * @returns {{ settings:object, repaired:string[], reason:string|null }} reason: 봉투를 못 연 사유(읽었으면 null)
 */
export function readSettings(text) {
  const envelope = decodeEnvelope(text, 'settings');
  if (!envelope.ok) return { ...normalizeSettings(null), reason: envelope.reason };
  const moved = migrate('settings', envelope.data, envelope.version);
  if (!moved.ok) return { ...normalizeSettings(null), reason: moved.reason };
  return { ...normalizeSettings(moved.data), reason: null };
}
