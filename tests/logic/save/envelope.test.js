import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAVE } from '../../../data/save.js';
import { checksumOf } from '../../../src/logic/save/checksum.js';
import { decodeEnvelope, encodeEnvelope } from '../../../src/logic/save/envelope.js';

test('체크섬: 8자리 16진수이고, 같은 글이면 같고 한 글자만 달라도 다르다', () => {
  assert.match(checksumOf('fable'), /^[0-9a-f]{8}$/);
  assert.equal(checksumOf('fable'), checksumOf('fable'));
  assert.notEqual(checksumOf('fable'), checksumOf('fablf'));
  assert.notEqual(checksumOf('ab'), checksumOf('ba'));
  assert.notEqual(checksumOf('가'), checksumOf('나'));
  assert.throws(() => checksumOf(123), TypeError);
});

test('체크섬 고정값: 값이 바뀌면 기존 세이브를 모두 손상으로 읽게 된다', () => {
  assert.equal(checksumOf(''), '811c9dc5');
  assert.equal(checksumOf('a'), '2b24d044');
  assert.equal(checksumOf('{"seed":"한글"}'), '8583e223');
});

test('봉투: 쓰고 읽으면 본문·버전·시각이 그대로다', () => {
  const data = { seed: '한글 시드', tick: 12, list: [1, 2.5, -3], nested: { a: null, b: true } };
  const text = encodeEnvelope({ kind: 'run', version: 4, data, savedAt: 1700000000000 });
  const read = decodeEnvelope(text, 'run');
  assert.deepEqual(read, { ok: true, version: 4, savedAt: 1700000000000, data, checksumOk: true });
  assert.equal(JSON.parse(text).format, SAVE.format);
});

test('봉투: 숫자 모양의 키가 섞여 있어도 체크섬이 맞는다(키 순서가 바뀌어 읽히는 경우)', () => {
  const data = { b: 1, 10: 'x', 9: 'y', a: { 2: 0, 1: 0 } };
  assert.equal(decodeEnvelope(encodeEnvelope({ kind: 'meta', version: 1, data }), 'meta').checksumOk, true);
});

test('봉투: 잘못된 인자로 쓰면 예외', () => {
  assert.throws(() => encodeEnvelope({ kind: 'score', version: 1, data: {} }), RangeError);
  assert.throws(() => encodeEnvelope({ kind: 'run', version: 0, data: {} }), RangeError);
  assert.throws(() => encodeEnvelope({ kind: 'run', version: 1.5, data: {} }), RangeError);
  assert.throws(() => encodeEnvelope({ kind: 'run', version: 1, data: [1] }), TypeError);
  assert.throws(() => encodeEnvelope({ kind: 'run', version: 1, data: null }), TypeError);
});

test('봉투: 읽지 못하는 값은 사유와 함께 거절하고 예외를 던지지 않는다', () => {
  const good = encodeEnvelope({ kind: 'run', version: 4, data: { a: 1 } });
  const env = (fn) => {
    const parsed = JSON.parse(good);
    fn(parsed);
    return JSON.stringify(parsed);
  };
  const cases = [
    [null, 'missing'],
    [undefined, 'missing'],
    [42, 'not-text'],
    [{ format: SAVE.format }, 'not-text'],
    ['', 'empty'],
    ['   \n', 'empty'],
    [good.slice(0, 20), 'bad-json'],
    [`${good}x`, 'bad-json'],
    ['{"a":NaN}', 'bad-json'],
    ['[1,2]', 'not-object'],
    ['"text"', 'not-object'],
    ['null', 'not-object'],
    ['7', 'not-object'],
    [env((e) => { e.format = 'nope'; }), 'bad-format'],
    [env((e) => { delete e.format; }), 'bad-format'],
    [env((e) => { e.kind = 'meta'; }), 'wrong-kind'],
    [env((e) => { e.version = '4'; }), 'bad-version'],
    [env((e) => { e.version = 0; }), 'bad-version'],
    [env((e) => { e.version = -1; }), 'bad-version'],
    [env((e) => { e.version = 1.5; }), 'bad-version'],
    [env((e) => { delete e.version; }), 'bad-version'],
    [env((e) => { delete e.data; }), 'no-data'],
    [env((e) => { e.data = null; }), 'no-data'],
    [env((e) => { e.data = [1]; }), 'no-data'],
    [env((e) => { e.data = 'x'; }), 'no-data'],
    [good + ' '.repeat(SAVE.maxTextLength), 'too-large'],
  ];
  for (const [text, reason] of cases) {
    assert.deepEqual(decodeEnvelope(text, 'run'), { ok: false, reason }, `${String(text).slice(0, 40)} → ${reason}`);
  }
});

test('봉투: 체크섬이 틀려도 열리지만 checksumOk 가 false 다', () => {
  const good = encodeEnvelope({ kind: 'run', version: 4, data: { gold: 100 } });
  assert.equal(decodeEnvelope(good.replace('"gold":100', '"gold":999'), 'run').checksumOk, false);
  const parsed = JSON.parse(good);
  delete parsed.checksum;
  assert.equal(decodeEnvelope(JSON.stringify(parsed), 'run').checksumOk, false);
  parsed.checksum = 12345;
  assert.equal(decodeEnvelope(JSON.stringify(parsed), 'run').checksumOk, false);
});

test('봉투: 시각이 이상하면 0 으로 읽는다(시각 때문에 세이브를 버리지 않는다)', () => {
  const good = encodeEnvelope({ kind: 'run', version: 4, data: { a: 1 }, savedAt: 5 });
  for (const value of ['"yesterday"', '-5', '1.5', 'null']) {
    const read = decodeEnvelope(good.replace('"savedAt":5', `"savedAt":${value}`), 'run');
    assert.equal(read.ok, true);
    assert.equal(read.savedAt, 0);
    assert.equal(read.checksumOk, true);
  }
  assert.equal(JSON.parse(encodeEnvelope({ kind: 'run', version: 4, data: {}, savedAt: Number.NaN })).savedAt, 0);
});
