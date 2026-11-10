// 동기식 이벤트버스. 로직 → 바깥(render/ui/audio) 통지에 쓴다.
//
// - 리스너는 등록 순서대로 즉시 호출된다(결정적 순서).
// - emit 도중 등록/해제해도 안전하다: 진행 중인 emit 은 시작 시점의 리스너 목록으로 끝까지 돈다.
//   단, emit 도중 해제된 리스너는 그 emit 에서도 더 이상 호출되지 않는다.
// - 리스너 하나가 예외를 던져도 나머지 리스너는 모두 호출된다.
//   예외는 onError 가 있으면 거기로 넘기고, 없으면 모든 리스너 호출이 끝난 뒤 다시 던진다.

export class EventBus {
  #listeners = new Map();

  /** 리스너 예외 처리기. (error, type, payload) => void. null 이면 emit 이 예외를 다시 던진다. */
  onError = null;

  /**
   * 리스너를 등록하고 해제 함수를 돌려준다.
   * @param {string} type
   * @param {(payload: any, type: string) => void} listener
   * @returns {() => void}
   */
  on(type, listener) {
    if (typeof type !== 'string' || type === '') throw new TypeError('EventBus.on: 이벤트 이름이 필요합니다');
    if (typeof listener !== 'function') throw new TypeError('EventBus.on: 리스너는 함수여야 합니다');
    const entry = { listener, active: true };
    let list = this.#listeners.get(type);
    if (!list) {
      list = [];
      this.#listeners.set(type, list);
    }
    list.push(entry);
    return () => this.#remove(type, entry);
  }

  /** 한 번만 호출되는 리스너를 등록한다. */
  once(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('EventBus.once: 리스너는 함수여야 합니다');
    const off = this.on(type, (payload, t) => {
      off();
      listener(payload, t);
    });
    return off;
  }

  /**
   * 이벤트를 발행한다.
   * @returns {number} 호출된 리스너 수
   */
  emit(type, payload) {
    const list = this.#listeners.get(type);
    if (!list || list.length === 0) return 0;
    const errors = [];
    let called = 0;
    for (const entry of list.slice()) {
      if (!entry.active) continue;
      called++;
      try {
        entry.listener(payload, type);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      if (typeof this.onError === 'function') {
        for (const err of errors) this.onError(err, type, payload);
      } else if (errors.length === 1) {
        throw errors[0];
      } else {
        throw new AggregateError(errors, `EventBus: "${type}" 리스너 ${errors.length}개가 예외를 던졌습니다`);
      }
    }
    return called;
  }

  /** 등록된 리스너 수. type 을 생략하면 전체 합계. */
  listenerCount(type) {
    if (type !== undefined) return this.#listeners.get(type)?.length ?? 0;
    let n = 0;
    for (const list of this.#listeners.values()) n += list.length;
    return n;
  }

  /** 리스너를 모두 해제한다. type 을 주면 그 이벤트만. */
  clear(type) {
    const types = type !== undefined ? [type] : [...this.#listeners.keys()];
    for (const t of types) {
      for (const entry of this.#listeners.get(t) ?? []) entry.active = false;
      this.#listeners.delete(t);
    }
  }

  #remove(type, entry) {
    if (!entry.active) return;
    entry.active = false;
    const list = this.#listeners.get(type);
    if (!list) return;
    const i = list.indexOf(entry);
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) this.#listeners.delete(type);
  }
}
