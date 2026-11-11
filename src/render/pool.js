// 오브젝트 풀. 투사체·장판·입자·피해 숫자처럼 자주 생겼다 사라지는 것을 미리 만들어 두고 돌려 쓴다
// (만들고 버리기를 되풀이하면 GPU 자원과 가비지가 쌓인다). Three.js 를 모른다 — Node 에서 테스트한다.

/**
 * @param {object} options
 * @param {() => T} options.create 새 객체를 만든다(모자랄 때만 불린다)
 * @param {(item:T) => void} [options.activate] 꺼낼 때
 * @param {(item:T) => void} [options.deactivate] 돌려놓을 때(보이지 않게 한다)
 * @param {number} options.max 만들 수 있는 최대 수. 다 쓰고 있으면 가장 오래된 것을 다시 쓴다
 * @template T
 */
export function createPool({ create, activate = () => {}, deactivate = () => {}, max }) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`createPool: 잘못된 크기 ${max}`);
  /** 쓰는 중인 것(꺼낸 순서). */
  const active = [];
  const free = [];
  let created = 0;
  let recycled = 0;

  return {
    /** 하나 꺼낸다. 최대 수에 닿았으면 가장 오래 쓴 것을 되돌려 받아 다시 쓴다. */
    acquire() {
      let item;
      if (free.length > 0) item = free.pop();
      else if (created < max) {
        item = create();
        created++;
      } else {
        item = active.shift();
        deactivate(item);
        recycled++;
      }
      active.push(item);
      activate(item);
      return item;
    },
    /** 돌려놓는다. 이미 돌려놓은 것이면 아무 일도 하지 않는다. */
    release(item) {
      const index = active.indexOf(item);
      if (index === -1) return false;
      active.splice(index, 1);
      deactivate(item);
      free.push(item);
      return true;
    },
    releaseAll() {
      while (active.length > 0) {
        const item = active.pop();
        deactivate(item);
        free.push(item);
      }
    },
    /** 쓰는 중인 것들(읽기 전용으로 쓴다). */
    get active() {
      return active;
    },
    /** 만든 것 전부를 돌며 fn 을 부른다(정리할 때). */
    forEach(fn) {
      for (const item of active) fn(item);
      for (const item of free) fn(item);
    },
    stats() {
      return { created, active: active.length, free: free.length, recycled, max };
    },
  };
}

/**
 * 칸 채우기식 풀: 프레임마다 begin() → 필요한 만큼 next() → end() 로 쓴다. 지난 프레임에 쓰고 이번에 쓰지 않은 것은 end() 가 숨긴다.
 * 상태(투사체·장판 목록)를 매 프레임 그대로 비추는 것들에 쓴다 — 무엇이 생기고 사라졌는지 따로 추적하지 않아도 된다.
 * @param {object} options
 * @param {() => T} options.create
 * @param {(item:T, shown:boolean) => void} options.show 보이기·숨기기
 * @param {number} options.max 넘으면 next() 가 null 을 돌려준다(그 프레임에는 그리지 않는다)
 * @template T
 */
export function createSlots({ create, show, max }) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`createSlots: 잘못된 크기 ${max}`);
  const items = [];
  let used = 0;
  let shown = 0;
  let dropped = 0;
  return {
    begin() {
      used = 0;
    },
    next() {
      if (used >= max) {
        dropped++;
        return null;
      }
      if (used === items.length) items.push(create());
      const item = items[used++];
      if (used > shown) show(item, true);
      return item;
    },
    end() {
      for (let i = used; i < shown; i++) show(items[i], false);
      shown = used;
    },
    forEach(fn) {
      for (const item of items) fn(item);
    },
    stats() {
      return { created: items.length, active: shown, dropped, max };
    },
  };
}
