// 브라우저 진입점(조립 지점). 로직·렌더·UI·소리·저장을 만들어 서로 연결하는 유일한 곳이다.

import { LOOP, RENDER } from '../data/config.js';
import { FEEL } from '../data/feel.js';
import { setInput } from './logic/combat/player.js';
import { interact, swapWeapons } from './logic/commands.js';
import { EventBus } from './logic/core/event-bus.js';
import { EVENTS } from './logic/core/events.js';
import { FixedStepLoop } from './logic/core/loop.js';
import { PHASE } from './logic/core/state.js';
import { createGame, enterFloor, rescueGame, resumeGame, setPhase, tick } from './logic/game.js';
import { withSetting } from './logic/save/settings.js';
import { createAudio } from './audio/engine.js';
import { createRenderer } from './render/renderer.js';
import { bindLifecycle, createAutosave } from './save/autosave.js';
import { createSaveStore } from './save/save-store.js';
import { openStorage } from './save/storage.js';
import { createUI } from './ui/app.js';
import { createDebugOverlay } from './ui/debug-overlay.js';
import { reasonText } from './ui/text.js';

// ?seed=... 새 게임을 그 시드로 시작한다(같은 판을 재현할 때). 없으면 시각에서 만든다 — 게임에 들어오는 비결정적 값은 이것뿐이다.
// ?debug=1 디버그 표시를 켜고, 확인용 손잡이(window.__fable)를 내놓는다.
const params = new URLSearchParams(window.location.search);
const DEBUG = params.has('debug');
const newSeed = () => Date.now().toString(36);

// ── 저장 ─────────────────────────────────────────────────────────────────────
const store = createSaveStore({ storage: openStorage(() => window.localStorage), now: () => Date.now() });
let loaded = store.load();
let settings = loaded.settings.settings;

const bus = new EventBus();
bus.onError = (err, type) => console.error(`[event ${type}]`, err);

/** 타이틀·거점에 머무는 동안의 게임: 층에 들어가지 않은 빈 런. 메타(영혼석·강화)만 의미가 있다. */
const lobby = (meta) => createGame({ seed: 'lobby', meta, bus });
let game = lobby(loaded.meta.meta);
let lastCharacter = 'knight';

/** 타이틀 화면이 보여 줄 것. */
const session = { canContinue: null, notices: [], lastRun: null };
function refreshSession() {
  const run = loaded.run.result;
  const progress = run.status === 'exact' ? run.state.run : run.status === 'salvage' ? run.core.run : null;
  session.canContinue = progress ? { character: progress.character, rooms: progress.roomsCleared } : null;
  session.notices = [];
  if (!store.persistent) session.notices.push('이 브라우저에서는 진행이 저장되지 않습니다. 페이지를 닫으면 사라집니다.');
  if (loaded.run.primaryIssue && loaded.run.source === 'backup') session.notices.push('세이브가 손상되어 바로 앞의 저장본으로 되돌렸습니다.');
  else if (run.status === 'salvage' && run.damaged) session.notices.push('세이브 일부가 손상되었습니다. 이어하면 처음 방부터 다시 시작합니다.');
  else if (loaded.run.primaryIssue && loaded.run.source === 'none') session.notices.push('세이브가 손상되어 이어할 수 없습니다.');
  if (loaded.meta.primaryIssue && loaded.meta.source === 'default') session.notices.push('거점 기록을 읽지 못했습니다.');
}
refreshSession();

let saveNote = '';
const autosave = createAutosave({
  getGame: () => game,
  store,
  onResult: ({ trigger, run }) => {
    if (run.ok) saveNote = `저장됨(${trigger})`;
    else if (run.reason !== 'run-ended' && run.reason !== 'not-started') {
      if (saveNote !== `저장 실패(${run.reason})`) ui.toast(run.reason === 'quota' ? '저장 공간이 모자라 저장하지 못했습니다' : '저장하지 못했습니다');
      saveNote = `저장 실패(${run.reason})`;
      console.warn('[save]', trigger, run.reason, run.problems ?? run.error ?? '');
    }
  },
});
autosave.attach(bus);
// 방을 깰 때마다도 저장한다(한 판이 한 층이라 층 이동 저장만으로는 드물다).
bus.on(EVENTS.ROOM_CLEARED, () => autosave.request('room'));

// ── 렌더·소리·ui ─────────────────────────────────────────────────────────────
const renderer = createRenderer({ canvas: document.getElementById('scene'), config: RENDER, quality: settings.quality });
renderer.attach(bus, () => game.state);

const audio = createAudio();
audio.setVolumes(settings);
audio.attach(bus, () => game.state);
// 소리는 첫 터치·클릭·키 입력 뒤에야 낼 수 있다.
// 어느 이벤트를 "사용자의 조작"으로 쳐 주는지는 브라우저마다 다르다(예전 iOS 는 touchend·click 만). 여러 이벤트에 걸어 둔다.
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
const unlockAudio = () => {
  if (audio.unlock() && audio.status().state === 'running') {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlockAudio, true);
  }
};
for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlockAudio, true);

function startMusic() {
  const { world } = game.state;
  audio.setMusic(world ? world.zoneId : null, false);
}

function startRun(character, seed = null) {
  lastCharacter = character;
  game = createGame({ seed: seed ?? (params.get('seed') || newSeed()), meta: game.state.meta, character, bus });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  hitstop = 0;
  ui.screens.closeAll();
  ui.syncVisibility();
}

/** 저장하고 타이틀로. 끝난 런이면 메타만 저장된다. */
function backToLobby() {
  autosave.saveNow('title');
  const meta = game.state.meta;
  loaded = store.load();
  game = lobby(meta);
  refreshSession();
  audio.setMusic(null);
}

const ui = createUI({
  root: document.getElementById('ui'),
  getGame: () => game,
  getSettings: () => settings,
  getSession: () => session,
  actions: {
    newGame: (character) => startRun(character),
    retry: () => startRun(game.state.meta.characters[lastCharacter] ? lastCharacter : 'knight'),
    continueGame() {
      let resumed = null;
      try {
        resumed = resumeGame({ run: loaded.run.result, meta: game.state.meta, bus });
      } catch (err) {
        console.error('[save] 이어하기 실패', err);
      }
      if (!resumed) {
        ui.toast('이어할 수 없습니다. 새 게임을 시작하세요');
        return;
      }
      game = resumed.game;
      lastCharacter = game.state.run.character;
      if (resumed.mode === 'rebuilt' && loaded.run.result.damaged) ui.toast('세이브가 손상되어 처음 방부터 다시 시작합니다');
      startMusic();
      ui.screens.closeAll(); // 닫히면서 PAUSED → PLAYING
      if (game.state.phase !== PHASE.PLAYING) setPhase(game, PHASE.PLAYING);
      ui.syncVisibility();
    },
    toTitle() {
      backToLobby();
      ui.screens.open('title');
    },
    toHub() {
      backToLobby();
      ui.screens.open('hub', 'title');
    },
    pause: () => setPhase(game, PHASE.PAUSED),
    resume: () => setPhase(game, PHASE.PLAYING),
    interact: () => doInteract(),
    swap: () => {
      const result = swapWeapons(game);
      if (!result.ok && result.reason !== 'not-playing') ui.toast(reasonText(result.reason));
    },
    setSetting(key, value) {
      settings = withSetting(settings, key, value);
      store.saveSettings(settings);
      if (key === 'quality') renderer.setQuality(value);
      audio.setVolumes(settings);
      ui.applySettings();
    },
    /** 영구 강화·해금을 샀다: 곧바로 저장한다(런 밖에서는 자동 저장이 돌지 않는다). */
    metaChanged: () => store.saveMeta(game.state.meta),
    sound: (name) => audio.play(name),
  },
});
// 결과 화면이 읽을 기록은 ui 가 결과 화면을 열기 전에 적어 둔다(같은 이벤트를 먼저 구독한다).
bus.on(EVENTS.RUN_ENDED, (e) => {
  session.lastRun = e;
});
ui.attach(bus);
ui.screens.open('title');

function doInteract() {
  const result = interact(game);
  if (!result.ok) {
    if (result.reason !== 'nothing' && result.reason !== 'not-playing') ui.toast(reasonText(result.reason));
    return;
  }
  if (result.type === 'shop') ui.screens.open('shop');
}

// ── 히트스톱: 맞히고 잡는 순간 게임을 아주 잠깐 멈춘다(로직의 틱을 늦출 뿐 결과는 같다) ──
let hitstop = 0;
const freeze = (sec) => {
  hitstop = Math.min(FEEL.hitstop.max, Math.max(hitstop, sec));
};
bus.on(EVENTS.DAMAGE_DEALT, (e) => {
  if (e.amount <= 0 || e.kind === 'dot') return;
  const { state } = game;
  if (e.targetId === state.playerId) freeze(FEEL.hitstop.hurt);
  else if (e.sourceId === state.playerId && (e.crit || e.amount >= FEEL.hitstop.minDamage)) freeze(e.crit ? FEEL.hitstop.crit : FEEL.hitstop.hit);
});
bus.on(EVENTS.ENTITY_DIED, (e) => {
  if (e.kind === 'boss') freeze(FEEL.hitstop.bossKill);
  else if (e.kind !== 'player') freeze(e.elite ? FEEL.hitstop.eliteKill : FEEL.hitstop.kill);
});

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  // 화면이 돌아가면 손가락 위치의 뜻이 달라진다. 쥐고 있던 입력을 놓는다.
  ui.resetInput();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.addEventListener('blur', () => ui.resetInput());
resize();

// 화면이 가려지면: 게임을 멈추고(일시정지 화면), 입력을 놓고, 소리를 끈다. 그다음에 저장된다(아래 bindLifecycle).
let lastTime = null;
/** 계속 누르는 입력(이동·조준·공격)을 로직에서도 놓는다. 멈춘 동안 상태(와 세이브)에 지난 입력이 남지 않도록. */
function releaseHeld() {
  setInput(game.state, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    ui.resetInput();
    releaseHeld();
    if (game.state.phase === PHASE.PLAYING && ui.screens.current === null) ui.screens.open('pause');
    audio.suspend();
  } else {
    ui.resetInput();
    audio.resume();
    lastTime = null; // 가려져 있던 시간을 한 프레임으로 치지 않는다.
  }
});
bindLifecycle({ doc: document, win: window, autosave });

// ── 루프 ─────────────────────────────────────────────────────────────────────
const overlay = DEBUG ? createDebugOverlay({ element: document.getElementById('debug') }) : null;
const loop = new FixedStepLoop({
  stepMs: 1000 / LOOP.tickRate,
  maxFrameMs: LOOP.maxFrameMs,
  update: (dtSec) => tick(game, dtSec),
});

/**
 * 틱이 예외를 던졌을 때: 핵심(시드·캐릭터·무기·축복·금화)만 건져 그 층을 다시 차리고, 그것도 안 되면 타이틀로 돌아간다.
 * 같은 일이 거듭되면 멈춰 둔다(무한 반복 방지).
 */
let crashes = 0;
function recover(err) {
  crashes++;
  console.error(`[tick] 예외 ${crashes}회`, err);
  let rescued = null;
  if (crashes <= 3) {
    try {
      rescued = rescueGame(game);
    } catch (inner) {
      console.error('[tick] 복구 실패', inner);
    }
  }
  if (rescued) {
    game = rescued;
    setPhase(game, PHASE.PLAYING);
    ui.toast('문제가 생겨 처음 방부터 다시 시작합니다');
  } else {
    const meta = game.state.meta;
    game = lobby(meta);
    ui.screens.open('title');
    ui.toast('문제가 생겨 판을 이어갈 수 없습니다');
  }
  ui.syncVisibility();
}

let alpha = 0;
/** 디버그용 자동 조작(브라우저 검증이 봇을 꽂는다). 있으면 화면 조작 대신 이것이 입력을 넣는다. */
let autopilot = null;
function frame(now) {
  const elapsed = lastTime === null ? 0 : now - lastTime;
  lastTime = now;
  const input = ui.takeInput();
  if (autopilot && game.state.phase === PHASE.PLAYING) {
    try {
      autopilot(game);
    } catch (err) {
      console.error('[autopilot]', err);
      autopilot = null;
    }
  } else if (game.state.phase === PHASE.PLAYING) {
    // 대시·스킬은 누른 프레임에만 넘긴다. 매번 "없음"을 넘기면 아직 처리되지 않은 입력을 지워 버린다.
    const next = { moveX: input.moveX, moveY: input.moveY, aimX: input.aimX, aimY: input.aimY, attack: input.attack };
    if (input.dash) next.dash = true;
    if (input.skill) next.skill = true;
    setInput(game.state, next);
    if (input.swap) ui.screens.current === null && swapWeapons(game);
    if (input.interact) doInteract();
  } else if (!autopilot) {
    releaseHeld();
  }
  if (hitstop > 0) {
    // 멈춘 동안에는 로직을 돌리지 않는다. 쌓인 시간은 버린다(멈춤이 끝나면 그 자리에서 이어진다).
    hitstop = Math.max(0, hitstop - elapsed / 1000);
  } else {
    try {
      ({ alpha } = loop.advance(elapsed));
    } catch (err) {
      recover(err);
    }
  }
  autosave.flush();
  renderer.render(game.state, game.state.phase === PHASE.PLAYING ? alpha : 1, Math.min(0.1, elapsed / 1000));
  ui.update();
  if (overlay) overlay.update(game.state, saveNote);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (DEBUG) {
  // 확인용 손잡이. scripts/browser 의 검증 스크립트가 쓴다. 평소에는 내놓지 않는다.
  window.__fable = {
    game: () => game,
    renderer,
    audio,
    ui,
    store,
    settings: () => settings,
    enterFloor: (floor) => enterFloor(game, floor),
    setPhase: (phase) => setPhase(game, phase),
    startRun,
    hitstop: () => hitstop,
    setAutopilot: (fn) => {
      autopilot = fn;
    },
    interact: doInteract,
  };
}
