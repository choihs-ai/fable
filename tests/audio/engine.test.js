// 소리 엔진을 가짜 AudioContext 로 시험한다(Node 에는 WebAudio 가 없다). 실제 소리가 나는지는 브라우저·기기에서만 확인할 수 있다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SFX } from '../../data/audio.js';
import { EventBus } from '../../src/logic/core/event-bus.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { createAudio } from '../../src/audio/engine.js';

/** 만들어진 음원과 연결을 세는 가짜 AudioContext. */
function fakeContext() {
  const log = { contexts: 0, sources: [], connected: 0, disconnected: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({
    connect(target) {
      log.connected++;
      return target;
    },
    disconnect() {
      log.disconnected++;
    },
    ...extra,
  });
  class Ctx {
    constructor() {
      log.contexts++;
      this.state = 'suspended';
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.destination = node();
    }
    createGain() {
      return node({ gain: param() });
    }
    createBiquadFilter() {
      return node({ frequency: param(), type: '' });
    }
    createBuffer(channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    }
    #source(kind) {
      const source = node({ kind, frequency: param(), type: '', onended: null, start() {}, stop() {} });
      log.sources.push(source);
      return source;
    }
    createOscillator() {
      return this.#source('osc');
    }
    createBufferSource() {
      return this.#source('noise');
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  }
  return { Ctx, log };
}

test('첫 입력 전에는 소리 장치를 만들지 않고, 효과음 요청은 조용히 버린다', () => {
  const { Ctx, log } = fakeContext();
  const audio = createAudio({ contextClass: () => Ctx });
  assert.equal(audio.play('hit'), false);
  audio.setMusic('crypt');
  assert.equal(log.contexts, 0);
  assert.deepEqual(audio.status().state, 'locked');
  assert.equal(audio.unlock(), true);
  assert.equal(log.contexts, 1);
  assert.equal(audio.unlock(), true, '여러 번 불러도 하나만 만든다');
  assert.equal(log.contexts, 1);
  assert.equal(audio.status().state, 'running');
  assert.equal(audio.play('hit'), true);
  audio.dispose();
});

test('소리를 낼 수 없는 환경: 예외 없이 아무 일도 하지 않는다', () => {
  const none = createAudio({ contextClass: () => null });
  assert.equal(none.unlock(), false);
  assert.equal(none.play('hit'), false);
  assert.equal(none.status().state, 'failed');
  const broken = createAudio({ contextClass: () => class { constructor() { throw new Error('장치 없음'); } } });
  assert.equal(broken.unlock(), false);
  assert.doesNotThrow(() => { broken.setMusic('crypt'); broken.suspend(); broken.resume(); broken.setVolumes({ masterVolume: 50, musicVolume: 50, sfxVolume: 50 }); broken.dispose(); });
  assert.throws(() => none.play('nope'), RangeError);
});

test('같은 효과음은 잇달아 내지 않고, 끝난 음원은 연결을 끊는다', () => {
  const { Ctx, log } = fakeContext();
  const audio = createAudio({ contextClass: () => Ctx });
  audio.unlock();
  assert.equal(audio.play('hit'), true);
  assert.equal(audio.play('hit'), false, '방금 낸 소리');
  assert.equal(audio.play('coin'), true, '다른 소리는 난다');
  assert.equal(audio.status().voices, 2);
  const before = log.disconnected;
  for (const source of log.sources) source.onended();
  assert.equal(audio.status().voices, 0);
  assert.ok(log.disconnected >= before + 4, '음원과 음량 노드를 모두 끊는다');
  // 모든 효과음 정의가 실제로 낼 수 있는 형식이다.
  const all = createAudio({ contextClass: () => Ctx });
  all.unlock();
  for (const name of Object.keys(SFX)) assert.equal(all.play(name), true, name);
  audio.dispose();
  all.dispose();
});

test('이벤트에 맞는 효과음이 나고, 화면이 가려지면 멈춘다', () => {
  const { Ctx, log } = fakeContext();
  const audio = createAudio({ contextClass: () => Ctx });
  const bus = new EventBus();
  const state = { playerId: 1 };
  const off = audio.attach(bus, () => state);
  audio.unlock();
  const count = () => log.sources.length;
  let n = count();
  bus.emit(EVENTS.DAMAGE_DEALT, { targetId: 5, amount: 3, crit: false });
  bus.emit(EVENTS.DAMAGE_DEALT, { targetId: 1, amount: 3 });
  bus.emit(EVENTS.DAMAGE_DEALT, { targetId: 5, amount: 0 });
  assert.equal(count(), n + 2, '피해 0 은 소리가 없다');
  bus.emit(EVENTS.FLOOR_ENTERED, { floor: 1, zoneId: 'crypt', kind: 'stage' });
  assert.deepEqual([audio.status().zone, audio.status().boss, audio.status().scheduling], ['crypt', false, true]);
  bus.emit(EVENTS.ROOM_ENTERED, { roomId: 3, kind: 'boss' });
  assert.equal(audio.status().boss, true, '보스 방에 들어서면 배경음이 빨라진다');
  // 무기마다 다른 소리, 대시·문·웨이브·방 깨기에도 소리가 난다.
  n = count();
  bus.emit(EVENTS.WEAPON_USED, { weapon: 'shotgun', kind: 'ranged', dash: false, offhand: false });
  bus.emit(EVENTS.WEAPON_USED, { weapon: 'sword', kind: 'melee', dash: false, offhand: false });
  bus.emit(EVENTS.PLAYER_DASHED, { id: 1 });
  bus.emit(EVENTS.DOORS_LOCKED, { roomId: 3, doors: [] });
  bus.emit(EVENTS.ROOM_CLEARED, { roomId: 3 });
  assert.equal(count(), n + 5);
  audio.suspend();
  n = count();
  bus.emit(EVENTS.BOON_CHOSEN, { boon: 'chain' });
  assert.equal(count(), n, '멈춘 동안에는 내지 않는다');
  assert.equal(audio.status().scheduling, false);
  audio.resume();
  bus.emit(EVENTS.RUN_ENDED, { victory: false });
  assert.equal(audio.status().zone, null);
  off();
  n = count();
  bus.emit(EVENTS.BOON_CHOSEN, { boon: 'pierce' });
  assert.equal(count(), n, '연결을 끊은 뒤');
  audio.dispose();
});
