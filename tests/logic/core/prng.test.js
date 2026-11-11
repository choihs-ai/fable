import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Rng } from '../../../src/logic/core/prng.js';

const take = (rng, n) => Array.from({ length: n }, () => rng.nextUint32());

// ── 시드 재현성 ──────────────────────────────────────────────────────────────

test('같은 시드는 같은 수열을 만든다', () => {
  assert.deepEqual(take(Rng.fromSeed('fable'), 1000), take(Rng.fromSeed('fable'), 1000));
});

test('다른 시드는 다른 수열을 만든다', () => {
  const a = take(Rng.fromSeed('fable'), 16);
  assert.notDeepEqual(a, take(Rng.fromSeed('fablf'), 16));
  assert.notDeepEqual(a, take(Rng.fromSeed('Fable'), 16));
  assert.notDeepEqual(a, take(Rng.fromSeed(''), 16));
});

test('숫자 시드와 같은 내용의 문자열 시드는 같은 수열이다', () => {
  assert.deepEqual(take(Rng.fromSeed(12345), 16), take(Rng.fromSeed('12345'), 16));
});

// 고정값 테스트: 아래 숫자가 바뀌면 알고리즘이 바뀐 것이고, 기존 시드·세이브가 전부 다른 결과를 낸다.
// 의도한 변경이 아니라면 구현을 되돌릴 것. 의도한 변경이라면 STATE_VERSION 을 올리고 BUGS.md 에 기록할 것.
test('고정값: 시드별 출력이 버전·플랫폼이 달라도 변하지 않는다', () => {
  assert.deepEqual(take(Rng.fromSeed('fable'), 8), [
    4066220685, 247517179, 3365860647, 2050649095, 1321752058, 2188787303, 1351371682, 2342501383,
  ]);
  assert.deepEqual(take(Rng.fromSeed(12345), 4), [525359247, 991750654, 228585090, 1703875677]);
  assert.deepEqual(take(Rng.fromSeed('fable').fork('world'), 4), [
    2798951847, 711813694, 3310663083, 466195033,
  ]);
  assert.deepEqual(take(Rng.fromSeed('fable').fork('world').fork('floor:3'), 4), [
    3029862960, 4028083237, 3459785048, 362980261,
  ]);
});

test('고정값: 파생 메서드(int/float/shuffle)의 출력도 변하지 않는다', () => {
  const ints = Rng.fromSeed('fable');
  assert.deepEqual(
    Array.from({ length: 10 }, () => ints.int(1, 6)),
    [4, 2, 4, 2, 5, 6, 5, 2, 1, 3],
  );
  assert.equal(Rng.fromSeed('fable').float(), 4066220685 / 2 ** 32);
  assert.deepEqual(Rng.fromSeed('fable').shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [6, 0, 1, 2, 3, 4, 9, 8, 7, 5]);
});

test('nextUint32 는 BigInt 로 따로 구현한 sfc32 기준 구현과 일치한다', () => {
  const rng = Rng.fromSeed('reference');
  let [a, b, c, d] = rng.snapshot().s.map(BigInt);
  const M = 0xffffffffn;
  const reference = () => {
    const t = (a + b + d) & M;
    d = (d + 1n) & M;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & M;
    c = (((c << 21n) | (c >> 11n)) & M) + t;
    c &= M;
    return Number(t);
  };

  for (let i = 0; i < 2000; i++) assert.equal(rng.nextUint32(), reference(), `${i}번째 출력`);
});

// ── 서브스트림 ───────────────────────────────────────────────────────────────

test('fork 는 부모를 소비하지 않는다', () => {
  const plain = Rng.fromSeed('fable');
  const forked = Rng.fromSeed('fable');
  forked.fork('a');
  forked.fork('b');

  assert.deepEqual(take(forked, 16), take(plain, 16));
});

test('fork 결과는 부모를 얼마나 소비했는지와 무관하다', () => {
  const fresh = Rng.fromSeed('fable');
  const used = Rng.fromSeed('fable');
  take(used, 500);

  assert.deepEqual(take(used.fork('world'), 16), take(fresh.fork('world'), 16));
});

test('자식 스트림을 소비해도 부모와 형제 스트림은 영향받지 않는다', () => {
  const a = Rng.fromSeed('fable');
  const b = Rng.fromSeed('fable');
  take(a.fork('combat'), 500);

  assert.deepEqual(take(a.fork('items'), 16), take(b.fork('items'), 16));
  assert.deepEqual(take(a, 16), take(b, 16));
});

test('같은 라벨은 같은 스트림, 다른 라벨은 다른 스트림이다', () => {
  const root = Rng.fromSeed('fable');
  const world = take(root.fork('world'), 16);

  assert.deepEqual(take(root.fork('world'), 16), world);
  assert.notDeepEqual(take(root.fork('items'), 16), world);
  assert.notDeepEqual(take(root, 16), world);
});

test('정수 라벨과 같은 내용의 문자열 라벨은 같은 스트림이다', () => {
  const root = Rng.fromSeed('fable');
  assert.deepEqual(take(root.fork(3), 8), take(root.fork('3'), 8));
});

test('중첩 fork 는 경로로 구분된다', () => {
  const root = Rng.fromSeed('fable');
  const ab = take(root.fork('a').fork('b'), 16);

  assert.deepEqual(take(root.fork('a').fork('b'), 16), ab);
  assert.notDeepEqual(take(root.fork('b').fork('a'), 16), ab);
  assert.notDeepEqual(take(root.fork('ab'), 16), ab);
  assert.notDeepEqual(take(root.fork('a'), 16), ab);
});

test('시드가 다르면 같은 라벨의 fork 도 다르다', () => {
  assert.notDeepEqual(take(Rng.fromSeed('x').fork('world'), 16), take(Rng.fromSeed('y').fork('world'), 16));
});

test('많은 라벨로 fork 해도 첫 출력이 겹치지 않는다', () => {
  const root = Rng.fromSeed('fable');
  const firsts = new Set();
  for (let i = 0; i < 2000; i++) firsts.add(root.fork(`floor:${i}`).nextUint32());

  assert.equal(firsts.size, 2000);
});

test('fork 는 잘못된 라벨을 거부한다', () => {
  const root = Rng.fromSeed('fable');
  for (const bad of ['', undefined, null, 1.5, NaN, {}]) {
    assert.throws(() => root.fork(bad), TypeError, `라벨: ${String(bad)}`);
  }
});

// ── 상태 저장/복원 ───────────────────────────────────────────────────────────

test('snapshot 으로 복원하면 그 지점부터 같은 수열이 이어진다', () => {
  const rng = Rng.fromSeed('fable');
  take(rng, 37);
  const snap = rng.snapshot();
  const expected = take(rng, 50);

  assert.deepEqual(take(new Rng(snap), 50), expected);
});

test('snapshot 은 JSON 왕복 후에도 유효하고 fork 결과도 보존된다', () => {
  const rng = Rng.fromSeed('fable').fork('items');
  take(rng, 11);
  const restored = new Rng(JSON.parse(JSON.stringify(rng.snapshot())));

  assert.deepEqual(take(restored.fork('chest'), 8), take(rng.fork('chest'), 8));
  assert.deepEqual(take(restored, 50), take(rng, 50));
});

test('snapshot 은 복사본이라 이후 진행의 영향을 받지 않는다', () => {
  const rng = Rng.fromSeed('fable');
  const snap = rng.snapshot();
  const copy = structuredClone(snap);
  take(rng, 10);

  assert.deepEqual(snap, copy);
});

test('Rng 는 넘겨받은 상태 객체를 제자리에서 갱신한다', () => {
  const data = Rng.fromSeed('fable').snapshot();
  const before = structuredClone(data);
  const rng = new Rng(data);

  rng.nextUint32();

  assert.equal(rng.data, data);
  assert.notDeepEqual(data.s, before.s);
  assert.deepEqual(data.key, before.key);
});

test('생성자는 잘못된 상태를 거부한다', () => {
  const good = Rng.fromSeed('fable').snapshot();
  const bads = [
    undefined,
    null,
    {},
    { key: good.key },
    { key: good.key, s: [1, 2, 3] },
    { key: good.key, s: [1, 2, 3, -1] },
    { key: good.key, s: [1, 2, 3, 2 ** 32] },
    { key: good.key, s: [1, 2, 3, 0.5] },
    { key: 'abcd', s: good.s },
  ];
  for (const bad of bads) assert.throws(() => new Rng(bad), TypeError, JSON.stringify(bad));
});

test('fromSeed 는 문자열·유한한 숫자가 아닌 시드를 거부한다', () => {
  for (const bad of [undefined, null, NaN, Infinity, {}, [], true, 10n]) {
    assert.throws(() => Rng.fromSeed(bad), TypeError, `시드: ${String(bad)}`);
  }
});

// ── 출력 범위와 분포 ─────────────────────────────────────────────────────────

test('nextUint32 는 [0, 2^32) 의 정수, float 는 [0, 1) 의 실수다', () => {
  const rng = Rng.fromSeed('range');
  for (let i = 0; i < 10_000; i++) {
    const u = rng.nextUint32();
    assert.ok(Number.isInteger(u) && u >= 0 && u < 2 ** 32);
    const f = rng.float();
    assert.ok(f >= 0 && f < 1);
  }
});

test('분포 점검: 평균·구간·비트가 한쪽으로 치우치지 않는다', () => {
  const rng = Rng.fromSeed('quality');
  const N = 200_000;
  let sum = 0;
  const buckets = new Array(16).fill(0);
  const bits = new Array(32).fill(0);
  for (let i = 0; i < N; i++) {
    const u = rng.nextUint32();
    sum += u / 2 ** 32;
    buckets[u >>> 28]++;
    for (let j = 0; j < 32; j++) if ((u >>> j) & 1) bits[j]++;
  }

  assert.ok(Math.abs(sum / N - 0.5) < 0.005, `평균 ${sum / N}`);
  for (const count of buckets) assert.ok(Math.abs(count - N / 16) < (N / 16) * 0.05, `구간 ${count}`);
  for (const count of bits) assert.ok(Math.abs(count / N - 0.5) < 0.01, `비트 비율 ${count / N}`);
});

test('int 는 양끝을 포함한 범위 안의 정수를 고르게 낸다', () => {
  const rng = Rng.fromSeed('dice');
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60_000; i++) {
    const v = rng.int(1, 6);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 6);
    counts[v - 1]++;
  }

  for (const count of counts) assert.ok(Math.abs(count - 10_000) < 500, `눈금 ${count}`);
});

test('int 는 음수 범위·한 값짜리 범위·2^32 크기 범위를 처리한다', () => {
  const rng = Rng.fromSeed('edges');
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rng.int(-2, 2));
  assert.deepEqual([...seen].sort((a, b) => a - b), [-2, -1, 0, 1, 2]);

  assert.equal(rng.int(7, 7), 7);

  for (let i = 0; i < 100; i++) {
    const v = rng.int(0, 2 ** 32 - 1);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 2 ** 32);
  }
});

test('int 는 잘못된 범위를 거부한다', () => {
  const rng = Rng.fromSeed('edges');
  assert.throws(() => rng.int(5, 4), RangeError);
  assert.throws(() => rng.int(0.5, 3), RangeError);
  assert.throws(() => rng.int(0, NaN), RangeError);
  assert.throws(() => rng.int(0, 2 ** 32), RangeError);
  assert.throws(() => rng.int(), RangeError);
});

test('chance: 0 은 항상 false, 1 은 항상 true, 그 사이는 비율이 맞는다', () => {
  const rng = Rng.fromSeed('chance');
  let hits = 0;
  for (let i = 0; i < 20_000; i++) {
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
    if (rng.chance(0.25)) hits++;
  }

  assert.ok(Math.abs(hits / 20_000 - 0.25) < 0.02, `비율 ${hits / 20_000}`);
  assert.throws(() => rng.chance(NaN), TypeError);
  assert.throws(() => rng.chance('0.5'), TypeError);
});

test('chance 는 확률 값과 무관하게 난수를 정확히 한 번 소비한다', () => {
  const a = Rng.fromSeed('fable');
  const b = Rng.fromSeed('fable');
  const c = Rng.fromSeed('fable');
  a.chance(0);
  b.chance(1);
  c.nextUint32();

  const next = c.nextUint32();
  assert.equal(a.nextUint32(), next);
  assert.equal(b.nextUint32(), next);
});

test('pick 은 배열의 원소를 고르고 모든 원소가 나올 수 있다', () => {
  const rng = Rng.fromSeed('pick');
  const items = ['a', 'b', 'c'];
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(rng.pick(items));

  assert.deepEqual([...seen].sort(), items);
  assert.throws(() => rng.pick([]), RangeError);
  assert.throws(() => rng.pick('abc'), RangeError);
});

test('shuffle 은 같은 배열을 제자리에서 섞은 순열을 돌려준다', () => {
  const rng = Rng.fromSeed('shuffle');
  const array = Array.from({ length: 50 }, (_, i) => i);
  const result = rng.shuffle(array);

  assert.equal(result, array);
  assert.deepEqual([...array].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i));
  assert.notDeepEqual(array, Array.from({ length: 50 }, (_, i) => i));
  assert.deepEqual(rng.shuffle([]), []);
  assert.deepEqual(rng.shuffle(['only']), ['only']);
});

test('shuffle 은 모든 순열을 고르게 만든다(원소 3개 → 6가지)', () => {
  const rng = Rng.fromSeed('perm');
  const counts = new Map();
  for (let i = 0; i < 12_000; i++) {
    const key = rng.shuffle([1, 2, 3]).join('');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  assert.equal(counts.size, 6);
  for (const [key, count] of counts) assert.ok(Math.abs(count - 2000) < 200, `${key}: ${count}`);
});

test('weightedIndex 는 가중치에 비례해 고르고 가중치 0 은 절대 고르지 않는다', () => {
  const rng = Rng.fromSeed('weights');
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 40_000; i++) counts[rng.weightedIndex([1, 0, 3, 4])]++;

  assert.equal(counts[1], 0);
  assert.ok(Math.abs(counts[0] / 40_000 - 1 / 8) < 0.01, `비율 ${counts[0] / 40_000}`);
  assert.ok(Math.abs(counts[2] / 40_000 - 3 / 8) < 0.015, `비율 ${counts[2] / 40_000}`);
  assert.ok(Math.abs(counts[3] / 40_000 - 4 / 8) < 0.015, `비율 ${counts[3] / 40_000}`);
  assert.equal(rng.weightedIndex([0, 0, 5]), 2);
  assert.equal(rng.weightedIndex([7]), 0);
});

test('weightedIndex 는 난수를 정확히 한 번 소비하고 결과가 재현된다', () => {
  const a = Rng.fromSeed('fable');
  const b = Rng.fromSeed('fable');
  a.weightedIndex([1, 2, 3]);
  b.nextUint32();
  assert.equal(a.nextUint32(), b.nextUint32());

  const picks = (seed) => {
    const rng = Rng.fromSeed(seed);
    return Array.from({ length: 20 }, () => rng.weightedIndex([5, 3, 2]));
  };
  assert.deepEqual(picks('fable'), picks('fable'));
});

test('weightedIndex 는 잘못된 가중치를 거부한다', () => {
  const rng = Rng.fromSeed('weights');
  for (const bad of [[], [0, 0], [1, -1], [1, NaN], [1, Infinity], [1, '2'], 'abc', null]) {
    assert.throws(() => rng.weightedIndex(bad), RangeError, JSON.stringify(bad));
  }
});
