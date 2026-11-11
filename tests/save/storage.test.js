import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAVE } from '../../data/save.js';
import { createMemoryStorage, isQuotaError, openStorage } from '../../src/save/storage.js';
import { createFakeStorage } from '../../scripts/lib/save-sim.js';

test('저장소 열기: 정상인 저장소는 영구 저장소로 쓰고, 시험용 키를 남기지 않는다', () => {
  const backend = createFakeStorage();
  const storage = openStorage(() => backend);
  assert.equal(storage.persistent, true);
  assert.equal(storage.reason, null);
  assert.equal(backend.items.has(SAVE.probeKey), false);
  assert.deepEqual(storage.set('k', 'v'), { ok: true });
  assert.equal(storage.get('k'), 'v');
  assert.equal(storage.remove('k'), true);
  assert.equal(storage.get('k'), null);
});

test('저장소 열기: 없거나 막혀 있으면 메모리 저장소로 대체하고 이유를 알린다', () => {
  const cases = [
    ['없음(undefined)', () => undefined, 'missing'],
    ['없음(null)', () => null, 'missing'],
    ['모양이 다름', () => ({ getItem() {} }), 'missing'],
    ['접근하면 예외(쿠키 차단)', () => { throw new Error('SecurityError'); }, 'blocked'],
    ['읽으면 예외', () => createFakeStorage({ failGet: true }), 'blocked'],
  ];
  for (const [name, provider, reason] of cases) {
    const storage = openStorage(provider);
    assert.equal(storage.persistent, false, name);
    assert.equal(storage.reason, reason, name);
    // 메모리 저장소로 그대로 동작한다.
    assert.deepEqual(storage.set('k', 'v'), { ok: true }, name);
    assert.equal(storage.get('k'), 'v', name);
  }
});

test('저장소 열기: 쓸 자리가 없으면(가득 참·예전 사파리 비공개 모드) 읽기는 그대로 하고 이유를 알린다', () => {
  const full = createFakeStorage({ items: { 'fable:run': 'saved' }, quota: 15 });
  const storage = openStorage(() => full);
  assert.equal(storage.persistent, true);
  assert.equal(storage.reason, 'full');
  assert.equal(storage.get('fable:run'), 'saved');

  const privateMode = openStorage(() => createFakeStorage({ failSet: true }));
  assert.equal(privateMode.persistent, true);
  assert.equal(privateMode.reason, 'full');
  const result = privateMode.set('k', 'v');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quota');
});

test('저장소: 쓰기·읽기·지우기의 예외를 결과로 바꾼다', () => {
  const backend = createFakeStorage();
  const storage = openStorage(() => backend);
  backend.quota = 10;
  const quota = storage.set('key', 'a long value');
  assert.equal(quota.ok, false);
  assert.equal(quota.reason, 'quota');
  backend.quota = Infinity;
  backend.setItem = () => { throw new TypeError('알 수 없는 오류'); };
  assert.equal(storage.set('key', 'v').reason, 'error');
  backend.failGet = true;
  assert.equal(storage.get('key'), null);
  backend.failRemove = true;
  assert.equal(storage.remove('key'), false);
  // getItem 이 문자열이 아닌 것을 돌려줘도 null 로 본다.
  const odd = openStorage(() => ({ getItem: () => 42, setItem() {}, removeItem() {} }));
  assert.equal(odd.get('x'), null);
});

test('용량 초과 예외: 브라우저마다 다른 이름·코드를 모두 알아본다', () => {
  assert.equal(isQuotaError({ name: 'QuotaExceededError' }), true);
  assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.equal(isQuotaError({ code: 22 }), true);
  assert.equal(isQuotaError({ code: 1014 }), true);
  assert.equal(isQuotaError(new Error('x')), false);
  assert.equal(isQuotaError(null), false);
  assert.equal(isQuotaError('QuotaExceededError'), false);
});

test('메모리 저장소: Storage 와 같은 모양이다', () => {
  const memory = createMemoryStorage();
  assert.equal(memory.getItem('a'), null);
  memory.setItem('a', 5);
  assert.equal(memory.getItem('a'), '5');
  memory.removeItem('a');
  assert.equal(memory.getItem('a'), null);
});
