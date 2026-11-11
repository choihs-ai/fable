// 세이브 저장소: 런·메타·설정을 저장소에 쓰고 읽는다. 직렬화·검증은 logic/save 가 하고, 여기서는 키와 백업을 다룬다.
//
// 키마다 세 칸을 쓴다.
//   <키>      최신 저장본
//   <키>:bak  바로 앞의 저장본(백업). 새로 쓰기 직전에 최신본이 멀쩡하면 여기로 옮긴다
//   <키>:bad  읽지 못한 원본(격리). 덮어쓰기 전에 한 벌 남겨 둔다(원인 조사용, 자리가 모자라면 가장 먼저 지운다)
// 읽을 때는 최신본과 백업을 모두 읽어 더 온전한 쪽을 고른다.
// 용량이 모자라면 격리본 → 런 백업 순으로 지우고 다시 쓴다. 그래도 안 되면 실패를 알리고, 이미 있는 저장본은 건드리지 않는다.

import { SAVE } from '../../data/save.js';
import { createMeta } from '../logic/items/meta.js';
import { readMeta, readRun, readSettings, serializeMeta, serializeRun, serializeSettings } from '../logic/save/codec.js';
import { decodeEnvelope } from '../logic/save/envelope.js';

const { keys } = SAVE;
const bak = (key) => key + SAVE.backupSuffix;
const bad = (key) => key + SAVE.quarantineSuffix;

/** 런 후보의 순위(작을수록 좋다): 그대로 이어하기 0, 건지기 1, 체크섬이 틀린 것을 건지기 2, 끝난 런 3, 못 씀 9. */
function runRank(result) {
  if (result.status === 'exact') return 0;
  if (result.status === 'salvage') return result.checksumOk ? 1 : 2;
  return result.status === 'finished' ? 3 : 9;
}

/** 메타 후보의 순위: 온전함 0, 일부 항목을 고침 1, 체크섬이 틀림 2, 못 씀 9. */
function metaRank(result) {
  if (!result.ok) return 9;
  if (!result.checksumOk) return 2;
  return result.repaired ? 1 : 0;
}

/**
 * @param {object} options
 * @param {ReturnType<import('./storage.js').openStorage>} options.storage
 * @param {() => number} [options.now] 저장 시각(ms)을 돌려주는 함수
 */
export function createSaveStore({ storage, now = () => 0 }) {
  /** 마지막으로 쓴 본문. 같은 내용을 다시 쓰지 않는다(백업이 같은 내용으로 덮이지 않도록). */
  const lastBody = { run: null, meta: null, settings: null };

  const bodyOf = (text) => text.slice(text.indexOf('"data":'));

  /** 자리를 비운다. 지운 것이 있으면 true. */
  function freeSpace(step) {
    const targets = step === 0 ? [bad(keys.run), bad(keys.meta), bad(keys.settings)] : [bak(keys.run)];
    let freed = false;
    for (const key of targets) {
      if (storage.get(key) !== null && storage.remove(key)) freed = true;
    }
    return freed;
  }

  /** 용량 초과면 자리를 비워 가며 다시 쓴다. allowDropBackup 이 false 면 런 백업은 지우지 않는다. */
  function setWithRetry(key, text, allowDropBackup) {
    let result = storage.set(key, text);
    for (let step = 0; !result.ok && result.reason === 'quota' && step < (allowDropBackup ? 2 : 1); step++) {
      if (freeSpace(step)) result = storage.set(key, text);
    }
    return result;
  }

  /**
   * 한 종류를 쓴다: 멀쩡한 최신본을 백업으로 옮긴 뒤 새 글을 쓴다.
   * @returns {{ ok:true, written:boolean, backedUp:boolean, length:number } | { ok:false, reason:string, error?:* }}
   */
  function write(kind, text, { backup }) {
    const key = keys[kind];
    const body = bodyOf(text);
    if (lastBody[kind] === body && storage.get(key) !== null) return { ok: true, written: false, backedUp: false, length: text.length };

    let backedUp = false;
    if (backup) {
      const old = storage.get(key);
      if (old !== null && bodyOf(old) !== body) {
        const envelope = decodeEnvelope(old, kind);
        // 백업은 실패해도 된다(그 경우 앞선 백업이 그대로 남는다).
        if (envelope.ok && envelope.checksumOk) backedUp = setWithRetry(bak(key), old, false).ok;
      }
    }
    const result = setWithRetry(key, text, true);
    if (!result.ok) return { ok: false, reason: result.reason, error: result.error };
    lastBody[kind] = body;
    return { ok: true, written: true, backedUp, length: text.length };
  }

  /** 읽지 못한 원본을 격리 칸에 남긴다(실패해도 무시). */
  function quarantine(kind, text) {
    if (typeof text === 'string' && text.length <= SAVE.maxTextLength) storage.set(bad(keys[kind]), text);
  }

  function loadRun() {
    const primaryText = storage.get(keys.run);
    const backupText = storage.get(bak(keys.run));
    const primary = readRun(primaryText);
    const backup = readRun(backupText);
    const useBackup = runRank(backup) < runRank(primary) && runRank(backup) <= 2;
    const result = useBackup ? backup : primary;
    // 최신본이 있는데 그대로 못 썼다면 덮어쓰기 전에 한 벌 남긴다.
    if (primaryText !== null && runRank(primary) !== 0 && primary.status !== 'finished') quarantine('run', primaryText);
    return {
      result,
      /** 'primary' | 'backup' | 'none' */
      source: runRank(result) <= 2 ? (useBackup ? 'backup' : 'primary') : 'none',
      /** 최신본이 왜 그대로 쓰이지 않았는가(문제가 없으면 null). */
      primaryIssue: primaryText === null || runRank(primary) === 0 ? null : (primary.reason ?? primary.status),
    };
  }

  function loadMeta() {
    const primaryText = storage.get(keys.meta);
    const primary = readMeta(primaryText);
    const backup = readMeta(storage.get(bak(keys.meta)));
    const useBackup = metaRank(backup) < metaRank(primary);
    const chosen = useBackup ? backup : primary;
    if (primaryText !== null && metaRank(primary) !== 0) quarantine('meta', primaryText);
    if (!chosen.ok) return { meta: createMeta(), source: 'default', primaryIssue: primaryText === null ? null : primary.reason };
    return {
      meta: chosen.meta,
      source: useBackup ? 'backup' : 'primary',
      primaryIssue: metaRank(primary) === 0 ? null : (primary.ok ? (primary.checksumOk ? 'repaired' : 'bad-checksum') : primary.reason),
    };
  }

  function loadSettings() {
    const text = storage.get(keys.settings);
    const result = readSettings(text);
    return { settings: result.settings, source: text === null || result.reason ? 'default' : 'primary', issue: text === null ? null : result.reason, repaired: result.repaired };
  }

  return {
    /** 저장소가 영구적인가(false 면 메모리 저장소), 그렇지 않다면 왜인가. */
    persistent: storage.persistent,
    storageIssue: storage.reason,

    /**
     * 저장된 것을 모두 읽는다. 예외를 던지지 않는다 — 못 읽은 것은 기본값(새 메타, 기본 설정, 런 없음)이 된다.
     * @returns {{ run:{ result:object, source:string, primaryIssue:string|null }, meta:{ meta:object, source:string, primaryIssue:string|null },
     *   settings:{ settings:object, source:string, issue:string|null, repaired:string[] } }}
     */
    load() {
      return { run: loadRun(), meta: loadMeta(), settings: loadSettings() };
    },

    /**
     * 런을 저장한다. 검증을 통과하지 못한 상태는 쓰지 않는다(앞선 저장본이 남는다).
     * @returns {{ ok:true, written:boolean, backedUp:boolean, length:number } | { ok:false, reason:string, problems?:string[], error?:* }}
     *   reason: serializeRun 의 것('run-ended' | 'not-started' | 'invalid-state') 또는 'quota' | 'error'
     */
    saveRun(state) {
      const serialized = serializeRun(state, now());
      if (!serialized.ok) return serialized;
      return write('run', serialized.text, { backup: true });
    },

    saveMeta(meta) {
      return write('meta', serializeMeta(meta, now()), { backup: true });
    },

    saveSettings(settings) {
      return write('settings', serializeSettings(settings, now()), { backup: false });
    },

    /** 런 세이브를 지운다(런이 끝났을 때). 백업도 함께 지운다 — 끝난 런이 백업에서 되살아나면 안 된다. */
    clearRun() {
      lastBody.run = null;
      const a = storage.remove(keys.run);
      const b = storage.remove(bak(keys.run));
      return a && b;
    },
  };
}
