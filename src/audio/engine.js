// 소리: WebAudio 로 합성하는 효과음과 배경음. 녹음된 파일을 쓰지 않는다.
//
// 브라우저(특히 모바일)는 사용자가 화면을 건드리기 전에는 소리를 내지 못하게 한다.
// 그래서 AudioContext 는 unlock() — 첫 터치·클릭·키 입력 — 에서 만든다. 그 전의 요청은 조용히 버린다.
// 소리를 낼 수 없는 환경(WebAudio 없음, 만들기 실패)에서는 모든 함수가 아무 일도 하지 않는다.

import { MUSIC, SFX, SFX_MIN_GAP, WEAPON_SFX } from '../../data/audio.js';
import { WEAPONS } from '../../data/weapons.js';
import { EVENTS } from '../logic/core/events.js';
import { Rng } from '../logic/core/prng.js';

/**
 * @param {object} [options]
 * @param {() => (new () => AudioContext)|null} [options.contextClass] AudioContext 생성자를 돌려준다(테스트에서 가짜를 끼운다)
 */
export function createAudio({ contextClass = () => globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null } = {}) {
  let ctx = null;
  let master = null;
  let sfxGain = null;
  let musicGain = null;
  let noise = null;
  let failed = false;
  let volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  /** 효과음 이름 → 마지막으로 낸 시각. */
  const lastPlayed = new Map();
  /** 지금 울리고 있는 음원 수(누수 확인용). */
  let voices = 0;
  let voicesStarted = 0;

  // 배경음
  let zone = null;
  let boss = false;
  let timer = null;
  let nextTime = 0;
  let step = 0;
  let wanted = false;

  function applyVolumes() {
    if (!ctx) return;
    master.gain.value = volumes.master;
    sfxGain.gain.value = volumes.sfx;
    musicGain.gain.value = volumes.music;
  }

  /** 음원을 켜고, 끝나면 연결을 끊어 버려지게 한다. */
  function voice(source, gainNode, out, start, stop) {
    source.connect(gainNode).connect(out);
    voices++;
    voicesStarted++;
    source.onended = () => {
      voices--;
      source.disconnect();
      gainNode.disconnect();
    };
    source.start(start);
    source.stop(stop);
  }

  function tone(wave, f0, f1, start, dur, gain, out) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    if (wave === 'noise') {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(f0, start);
      filter.frequency.exponentialRampToValueAtTime(f1, start + dur);
      // 잡음 → 대역 필터 → 음량 → 출력. 끝나면 필터까지 끊는다.
      source.connect(filter);
      filter.connect(env);
      env.connect(out);
      voices++;
      voicesStarted++;
      source.onended = () => {
        voices--;
        source.disconnect();
        filter.disconnect();
        env.disconnect();
      };
      source.start(start);
      source.stop(start + dur + 0.02);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
    voice(osc, env, out, start, start + dur + 0.02);
  }

  function scheduleMusic() {
    if (!ctx || !zone || ctx.state !== 'running') return;
    const song = MUSIC.zones[zone] ?? MUSIC.zones.crypt;
    const beat = 60 / (song.bpm * (boss ? MUSIC.bossTempoMul : 1)) / 2;
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
    const freq = (degree, octave) => {
      const n = song.scale.length;
      const semis = song.scale[((degree % n) + n) % n] + 12 * (Math.floor(degree / n) + octave);
      return song.root * 2 ** (semis / 12);
    };
    while (nextTime < ctx.currentTime + MUSIC.lookahead) {
      const i = step % song.bass.length;
      if (song.bass[i] >= 0) tone('triangle', freq(song.bass[i], 0), freq(song.bass[i], 0), nextTime, beat * 0.95, MUSIC.gain.bass, musicGain);
      if (song.lead[i] >= 0) tone('sine', freq(song.lead[i], 1), freq(song.lead[i], 1), nextTime, beat * 0.6, MUSIC.gain.lead, musicGain);
      nextTime += beat;
      step++;
    }
  }

  function startTimer() {
    if (timer === null && ctx && wanted) timer = setInterval(scheduleMusic, MUSIC.intervalMs);
  }
  function stopTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  return {
    /**
     * 첫 터치·클릭·키 입력에서 부른다: 소리 장치를 만들고 켠다. 여러 번 불러도 된다.
     * @returns {boolean} 소리를 낼 수 있는가
     */
    unlock() {
      if (failed) return false;
      if (!ctx) {
        try {
          const Ctor = contextClass();
          if (!Ctor) throw new Error('WebAudio 없음');
          ctx = new Ctor();
          master = ctx.createGain();
          sfxGain = ctx.createGain();
          musicGain = ctx.createGain();
          sfxGain.connect(master);
          musicGain.connect(master);
          master.connect(ctx.destination);
          // 잡음: 시드 난수로 한 번 만들어 두고 돌려 쓴다(Math.random 은 쓰지 않는다).
          const rng = Rng.fromSeed('audio:noise');
          noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
          const data = noise.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = rng.float() * 2 - 1;
          applyVolumes();
        } catch {
          failed = true;
          ctx = null;
          return false;
        }
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      startTimer();
      return true;
    },
    /** 효과음 하나. 아직 켜지지 않았거나 방금 낸 소리면 버린다. @returns {boolean} 실제로 냈는가 */
    play(name) {
      const def = SFX[name];
      if (!def) throw new RangeError(`play: 알 수 없는 효과음 "${name}"`);
      if (!ctx || ctx.state !== 'running') return false;
      const now = ctx.currentTime;
      if (now - (lastPlayed.get(name) ?? -1) < SFX_MIN_GAP) return false;
      lastPlayed.set(name, now);
      tone(def.wave, def.freq[0], def.freq[1], now, def.dur, def.gain, sfxGain);
      return true;
    },
    /** 음량(0~100). */
    setVolumes({ masterVolume, musicVolume, sfxVolume }) {
      volumes = { master: masterVolume / 100, music: musicVolume / 100, sfx: sfxVolume / 100 };
      applyVolumes();
    },
    /** 배경음을 정한다. zoneId 가 null 이면 끈다. */
    setMusic(zoneId, isBoss = false) {
      if (zoneId !== zone) step = 0;
      zone = zoneId;
      boss = isBoss;
      wanted = zoneId !== null;
      if (wanted) startTimer();
      else stopTimer();
    },
    /** 화면이 가려졌을 때: 소리를 멈춘다. */
    suspend() {
      stopTimer();
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    },
    /** 화면으로 돌아왔을 때. */
    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      startTimer();
    },
    /**
     * 이벤트버스에 연결한다: 일어난 일에 맞는 효과음을 낸다. @returns {() => void}
     * @param {() => object} getState
     */
    attach(bus, getState) {
      const play = (name) => () => this.play(name);
      const offs = [
        bus.on(EVENTS.DAMAGE_DEALT, (e) => {
          if (e.amount <= 0 || e.kind === 'dot') return;
          this.play(e.targetId === getState().playerId ? 'hurt' : e.proc === 'bolt' ? 'bolt' : e.crit ? 'crit' : 'hit');
        }),
        bus.on(EVENTS.ENTITY_DIED, (e) => {
          if (e.kind !== 'player') this.play(e.kind === 'boss' ? 'bossKill' : 'kill');
        }),
        bus.on(EVENTS.WEAPON_USED, (e) => {
          if (e.bash) this.play('swing');
          else this.play(WEAPON_SFX[WEAPONS[e.weapon].look] ?? 'swing');
        }),
        bus.on(EVENTS.ENERGY_EMPTY, play('empty')),
        bus.on(EVENTS.PLAYER_DASHED, play('dash')),
        bus.on(EVENTS.SKILL_USED, play('skill')),
        bus.on(EVENTS.WEAPON_SWAPPED, play('swap')),
        bus.on(EVENTS.WEAPON_PICKED, play('pickup')),
        bus.on(EVENTS.EXPLOSION, play('explosion')),
        bus.on(EVENTS.CHAIN_LIGHTNING, play('bolt')),
        bus.on(EVENTS.DROP_COLLECTED, (e) => this.play(e.kind === 'gold' ? 'coin' : 'pickup')),
        bus.on(EVENTS.BOON_CHOSEN, play('boon')),
        bus.on(EVENTS.SHOP_PURCHASE, play('coin')),
        bus.on(EVENTS.DOORS_LOCKED, play('doorLock')),
        bus.on(EVENTS.DOORS_OPENED, play('doorOpen')),
        bus.on(EVENTS.WAVE_STARTED, play('wave')),
        bus.on(EVENTS.ROOM_CLEARED, play('clear')),
        bus.on(EVENTS.SECRET_FOUND, play('secret')),
        bus.on(EVENTS.BOSS_PHASE_CHANGED, play('phase')),
        bus.on(EVENTS.ROOM_ENTERED, (e) => {
          if (e.kind === 'boss') this.setMusic(zone, true);
        }),
        bus.on(EVENTS.FLOOR_ENTERED, (e) => {
          this.play('portal');
          this.setMusic(e.zoneId, false);
        }),
        bus.on(EVENTS.RUN_ENDED, (e) => {
          this.play(e.victory ? 'victory' : 'death');
          this.setMusic(null);
        }),
      ];
      return () => offs.forEach((off) => off());
    },
    /** 현황(확인용). */
    status() {
      return { unlocked: ctx !== null, state: ctx ? ctx.state : failed ? 'failed' : 'locked', zone, boss, voices, voicesStarted, scheduling: timer !== null };
    },
    dispose() {
      stopTimer();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
