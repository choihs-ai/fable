// 시드 PRNG. 게임의 모든 난수는 이 모듈 하나에서만 나온다(Math.random 금지).
//
// - 생성기: sfc32 (32비트 상태 4개, 정수 연산만 사용 → 플랫폼이 달라도 같은 수열)
// - 서브스트림: fork(label). 자식 스트림은 "부모의 키 + 라벨"만으로 결정되며
//   부모를 얼마나 소비했는지와 무관하다. 따라서 한 스트림에 난수 호출을 추가해도
//   다른 스트림의 수열은 밀리지 않는다.
// - 상태는 평범한 객체 { key:[4], s:[4] } 이고 Rng 는 그 객체를 제자리에서 갱신한다.
//   게임 상태 안에 이 객체를 넣어 두면 세이브/로드 시 난수 위치까지 그대로 보존된다.

const U32 = 0x100000000;
const WARMUP_ROUNDS = 15;

/** 키(uint32 4개)에 문자열을 섞어 새 키를 만든다. cyrb128 계열 해시. */
function mixKey(key, text) {
  let h1 = key[0] ^ 1779033703;
  let h2 = key[1] ^ 3144134277;
  let h3 = key[2] ^ 1013904242;
  let h4 = key[3] ^ 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function isU32Quad(v) {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => Number.isInteger(n) && n >= 0 && n < U32)
  );
}

function fromKey(key) {
  const rng = new Rng({ key, s: key.slice() });
  for (let i = 0; i < WARMUP_ROUNDS; i++) rng.nextUint32();
  return rng;
}

export class Rng {
  #d;

  /**
   * 기존 상태 객체를 감싼다. 객체는 복사하지 않고 제자리에서 갱신한다.
   * 새 스트림은 Rng.fromSeed / fork 로 만든다.
   * @param {{key:number[], s:number[]}} data
   */
  constructor(data) {
    if (!data || !isU32Quad(data.key) || !isU32Quad(data.s)) {
      throw new TypeError('Rng: 상태는 { key:[uint32×4], s:[uint32×4] } 형태여야 합니다');
    }
    this.#d = data;
  }

  /** 시드(문자열 또는 유한한 숫자)로 루트 스트림을 만든다. 1 과 "1" 은 같은 시드다. */
  static fromSeed(seed) {
    const ok = typeof seed === 'string' || (typeof seed === 'number' && Number.isFinite(seed));
    if (!ok) throw new TypeError('Rng.fromSeed: 시드는 문자열 또는 유한한 숫자여야 합니다');
    return fromKey(mixKey([0, 0, 0, 0], `seed:${seed}`));
  }

  /** 감싸고 있는 상태 객체(직렬화 가능). 참조를 그대로 돌려준다. */
  get data() {
    return this.#d;
  }

  /** 현재 상태의 독립된 복사본. Rng 생성자에 넘기면 이 지점부터 같은 수열이 이어진다. */
  snapshot() {
    return { key: this.#d.key.slice(), s: this.#d.s.slice() };
  }

  /**
   * 라벨로 구분되는 독립 서브스트림을 만든다. 부모 스트림은 소비하지 않는다.
   * 같은 부모에서 같은 라벨로 fork 하면 항상 같은 스트림이 나오므로 라벨은 용도별로 달라야 한다.
   * @param {string|number} label 예: 'world', `floor:${n}`
   */
  fork(label) {
    const ok = typeof label === 'string' || Number.isInteger(label);
    if (!ok || label === '') throw new TypeError('Rng.fork: 라벨은 비어 있지 않은 문자열 또는 정수여야 합니다');
    return fromKey(mixKey(this.#d.key, `fork:${label}`));
  }

  /** [0, 2^32) 범위의 정수. */
  nextUint32() {
    const s = this.#d.s;
    let a = s[0] | 0;
    let b = s[1] | 0;
    let c = s[2] | 0;
    let d = s[3] | 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    s[0] = a >>> 0;
    s[1] = b >>> 0;
    s[2] = c >>> 0;
    s[3] = d >>> 0;
    return t >>> 0;
  }

  /** [0, 1) 범위의 실수. */
  float() {
    return this.nextUint32() / U32;
  }

  /** [min, max] 범위(양끝 포함)의 정수. 나머지 편향이 없도록 기각 샘플링한다. */
  int(min, max) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`Rng.int: 잘못된 범위 [${min}, ${max}]`);
    }
    const range = max - min + 1;
    if (range > U32) throw new RangeError('Rng.int: 범위가 2^32 를 넘습니다');
    const limit = U32 - (U32 % range);
    let x;
    do {
      x = this.nextUint32();
    } while (x >= limit);
    return min + (x % range);
  }

  /**
   * 확률 p 로 true. p 가 0 이나 1 이어도 난수를 정확히 한 번 소비하므로
   * 확률 수치를 조정해도 이후 수열이 밀리지 않는다.
   */
  chance(p) {
    if (typeof p !== 'number' || Number.isNaN(p)) throw new TypeError('Rng.chance: p 는 숫자여야 합니다');
    return this.float() < p;
  }

  /** 배열에서 원소 하나를 고른다. */
  pick(array) {
    if (!Array.isArray(array) || array.length === 0) {
      throw new RangeError('Rng.pick: 비어 있지 않은 배열이 필요합니다');
    }
    return array[this.int(0, array.length - 1)];
  }

  /**
   * 가중치에 비례한 확률로 인덱스 하나를 고른다. 가중치는 0 이상의 유한한 수이고 합이 0보다 커야 한다.
   * 난수를 정확히 한 번 소비한다.
   * @param {number[]} weights
   */
  weightedIndex(weights) {
    if (!Array.isArray(weights) || weights.length === 0) {
      throw new RangeError('Rng.weightedIndex: 비어 있지 않은 가중치 배열이 필요합니다');
    }
    let total = 0;
    for (const w of weights) {
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
        throw new RangeError(`Rng.weightedIndex: 잘못된 가중치 ${w}`);
      }
      total += w;
    }
    if (!(total > 0)) throw new RangeError('Rng.weightedIndex: 가중치 합이 0보다 커야 합니다');
    let r = this.float() * total;
    let last = 0;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] === 0) continue;
      last = i;
      r -= weights[i];
      if (r < 0) return i;
    }
    return last;
  }

  /** 배열을 제자리에서 섞고(Fisher–Yates) 같은 배열을 돌려준다. */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }
}
