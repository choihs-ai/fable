// 자동 저장: 언제 저장할지를 정한다.
//   - 층 이동(FLOOR_ENTERED), 일시정지(PHASE_CHANGED → paused), 런 종료(RUN_ENDED): 저장을 예약하고, 틱이 끝난 뒤 flush() 에서 쓴다.
//     이벤트는 틱 도중에 날 수 있어서, 그 자리에서 쓰면 반쯤 갱신된 상태가 저장될 수 있다.
//   - 백그라운드 전환(visibilitychange·pagehide): 곧바로 쓴다. 이 이벤트는 프레임 사이에 오고, 다음 프레임이 없을 수 있다.
// 저장이 실패해도 게임은 계속된다 — 결과는 onResult 로 알릴 뿐이다.

import { EVENTS } from '../logic/core/events.js';
import { PHASE } from '../logic/core/state.js';

/**
 * @param {object} options
 * @param {() => { state:object, bus:object }} options.getGame 지금의 게임(런을 다시 차리면 바뀔 수 있다)
 * @param {ReturnType<import('./save-store.js').createSaveStore>} options.store
 * @param {(result:object) => void} [options.onResult] 저장할 때마다 결과를 받는다: { trigger, run, meta }
 */
export function createAutosave({ getGame, store, onResult = null }) {
  let pending = null;

  /** 지금 상태를 저장한다. 끝난 런이면 메타만 저장하고 런 세이브를 지운다. */
  function saveNow(trigger) {
    pending = null;
    let result;
    try {
      const { state } = getGame();
      const meta = store.saveMeta(state.meta);
      if (state.run.ended) {
        store.clearRun();
        result = { trigger, meta, run: { ok: false, reason: 'run-ended' } };
      } else {
        result = { trigger, meta, run: store.saveRun(state) };
      }
    } catch (error) {
      result = { trigger, meta: { ok: false, reason: 'exception', error }, run: { ok: false, reason: 'exception', error } };
    }
    if (onResult) {
      try {
        onResult(result);
      } catch {
        // 알림을 받는 쪽의 오류가 저장 흐름을 끊지 않게 한다.
      }
    }
    return result;
  }

  return {
    /** 이벤트버스에 연결한다. @returns {() => void} 연결을 끊는 함수 */
    attach(bus) {
      const offs = [
        bus.on(EVENTS.FLOOR_ENTERED, () => {
          pending = pending ?? 'floor';
        }),
        bus.on(EVENTS.PHASE_CHANGED, ({ to }) => {
          if (to === PHASE.PAUSED) pending = pending ?? 'pause';
        }),
        bus.on(EVENTS.RUN_ENDED, () => {
          pending = 'run-ended';
        }),
      ];
      return () => offs.forEach((off) => off());
    },
    /** 저장을 예약한다(다음 flush 때 쓴다). */
    request(trigger) {
      pending = pending ?? trigger;
    },
    /** 예약된 저장이 있으면 쓴다. 틱이 끝난 뒤(프레임마다) 부른다. @returns {object|null} */
    flush() {
      return pending === null ? null : saveNow(pending);
    },
    saveNow,
    get pending() {
      return pending;
    },
  };
}

/**
 * 페이지가 가려지거나 닫힐 때 저장하도록 연결한다.
 * @param {{ doc:Document, win:Window, autosave:{ saveNow:Function } }} options 테스트에서는 가짜 대상을 넣는다
 * @returns {() => void} 연결을 끊는 함수
 */
export function bindLifecycle({ doc, win, autosave }) {
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') autosave.saveNow('background');
  };
  const onPageHide = () => autosave.saveNow('pagehide');
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onPageHide);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onPageHide);
  };
}
