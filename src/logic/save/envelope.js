// 세이브 봉투: 본문(data)을 형식 이름·종류·버전·체크섬과 함께 한 줄의 JSON 으로 감싼다.
//   {"format":"fable-save","kind":"run","version":4,"savedAt":0,"checksum":"0a1b2c3d","data":{…}}
// 체크섬은 본문을 JSON 으로 쓴 글에 대한 것이다. 읽을 때는 파싱한 본문을 다시 글로 써서 비교한다
// (JSON.stringify 는 같은 값에 같은 글을 내므로, 저장한 그대로 읽혔다면 반드시 일치한다).
// 시각(savedAt)은 바깥에서 받는다 — 로직은 시계를 읽지 않는다.

import { SAVE } from '../../../data/save.js';
import { checksumOf } from './checksum.js';
import { isInt, isObject } from './schema.js';

export const SAVE_KINDS = Object.freeze(['run', 'meta', 'settings']);

/**
 * @param {{ kind:string, version:number, data:object, savedAt?:number }} options
 * @returns {string}
 */
export function encodeEnvelope({ kind, version, data, savedAt = 0 }) {
  if (!SAVE_KINDS.includes(kind)) throw new RangeError(`encodeEnvelope: 알 수 없는 종류 "${kind}"`);
  if (!isInt(version, 1, 1e9)) throw new RangeError(`encodeEnvelope: 버전이 올바르지 않습니다 (${version})`);
  if (!isObject(data)) throw new TypeError('encodeEnvelope: 본문이 객체가 아닙니다');
  const body = JSON.stringify(data);
  const at = isInt(savedAt, 0, Number.MAX_SAFE_INTEGER) ? savedAt : 0;
  return `{"format":${JSON.stringify(SAVE.format)},"kind":"${kind}","version":${version},"savedAt":${at},"checksum":"${checksumOf(body)}","data":${body}}`;
}

/**
 * 봉투를 연다. 어떤 값을 받아도 예외를 던지지 않는다.
 * @param {*} text 저장소에서 읽은 값
 * @param {string} kind 기대하는 종류
 * @returns {{ ok:true, version:number, savedAt:number, data:object, checksumOk:boolean } | { ok:false, reason:string }}
 *   reason: 'missing'(값이 없음) | 'not-text' | 'empty' | 'too-large' | 'bad-json' | 'not-object' | 'bad-format'
 *         | 'wrong-kind' | 'bad-version' | 'no-data'
 *   체크섬이 틀려도 ok 다 — checksumOk 로 알리고, 어떻게 다룰지는 부르는 쪽이 정한다.
 */
export function decodeEnvelope(text, kind) {
  if (text === null || text === undefined) return { ok: false, reason: 'missing' };
  if (typeof text !== 'string') return { ok: false, reason: 'not-text' };
  if (text.trim() === '') return { ok: false, reason: 'empty' };
  if (text.length > SAVE.maxTextLength) return { ok: false, reason: 'too-large' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  if (!isObject(parsed)) return { ok: false, reason: 'not-object' };
  if (parsed.format !== SAVE.format) return { ok: false, reason: 'bad-format' };
  if (parsed.kind !== kind) return { ok: false, reason: 'wrong-kind' };
  if (!isInt(parsed.version, 1, 1e9)) return { ok: false, reason: 'bad-version' };
  if (!isObject(parsed.data)) return { ok: false, reason: 'no-data' };
  const checksumOk = typeof parsed.checksum === 'string' && parsed.checksum === checksumOf(JSON.stringify(parsed.data));
  const savedAt = isInt(parsed.savedAt, 0, Number.MAX_SAFE_INTEGER) ? parsed.savedAt : 0;
  return { ok: true, version: parsed.version, savedAt, data: parsed.data, checksumOk };
}
