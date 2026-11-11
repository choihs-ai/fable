// 저장소 접근. localStorage 는 없을 수도 있고(비공개 모드·쿠키 차단·오래된 웹뷰), 접근만 해도 예외를 던질 수 있고,
// 가득 차 있을 수도 있다. 여기서 그 차이를 모두 흡수해서, 나머지 코드는 예외 없이 결과만 받는다.
// 저장소는 바깥에서 건네받는다(브라우저에서는 () => window.localStorage) — Node 테스트에서 가짜를 끼울 수 있다.

import { SAVE } from '../../data/save.js';

/** 용량 초과 예외인가. 브라우저마다 이름·코드가 다르다. */
export function isQuotaError(err) {
  if (!err || typeof err !== 'object') return false;
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
}

/** 메모리에만 두는 저장소(Storage 와 같은 모양). 페이지를 닫으면 사라진다. */
export function createMemoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

/**
 * 저장소를 열어 안전한 접근기를 만든다.
 * @param {() => Storage} provider 저장소를 돌려주는 함수. 접근이 막혀 있으면 예외를 던질 수 있다
 * @returns {{
 *   persistent: boolean,          // false 면 메모리 저장소로 대체됐다(페이지를 닫으면 사라진다)
 *   reason: null|'missing'|'blocked'|'full',  // 'full' 은 읽을 수는 있지만 지금은 쓸 자리가 없다는 뜻이다
 *   get(key): string|null,
 *   set(key, value): { ok:true } | { ok:false, reason:'quota'|'error', error },
 *   remove(key): boolean,
 * }}
 */
export function openStorage(provider) {
  let backend = null;
  let reason = null;
  try {
    backend = provider();
    if (!backend || typeof backend.getItem !== 'function' || typeof backend.setItem !== 'function' || typeof backend.removeItem !== 'function') {
      backend = null;
      reason = 'missing';
    }
  } catch {
    backend = null;
    reason = 'blocked';
  }
  if (backend) {
    try {
      backend.getItem(SAVE.probeKey); // 읽기조차 막힌 환경을 걸러낸다.
      try {
        backend.setItem(SAVE.probeKey, '1');
        backend.removeItem(SAVE.probeKey);
      } catch (err) {
        // 쓸 자리가 없어도 이미 있는 세이브는 읽을 수 있다. 저장할 때 자리를 비우고 다시 시도한다.
        if (isQuotaError(err)) reason = 'full';
        else throw err;
      }
    } catch {
      backend = null;
      reason = 'blocked';
    }
  }
  const persistent = backend !== null;
  if (!backend) backend = createMemoryStorage();

  return {
    persistent,
    reason,
    get(key) {
      try {
        const value = backend.getItem(key);
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        backend.setItem(key, value);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: isQuotaError(error) ? 'quota' : 'error', error };
      }
    },
    remove(key) {
      try {
        backend.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
