// 브라우저 진입점(조립 지점). 로직·렌더·UI·소리·저장을 만들어 서로 연결하는 유일한 곳이다.

import { LOOP, RENDER } from '../data/config.js';
import { setInput } from './logic/combat/player.js';
import { descendStairs } from './logic/commands.js';
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

// ?seed=... 새 게임을 그 시드로 시작한다(같은 런을 재현할 때). 없으면 시각에서 만든다 — 게임에 들어오는 비결정적 값은 이것뿐이다.
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

/** 타이틀에 머무는 동안의 게임: 층에 들어가지 않은 빈 런. 메타(영구 해금)만 의미가 있다. */
const lobby = (meta) => createGame({ seed: 'lobby', meta, bus });
let game = lobby(loaded.meta.meta);

/** 타이틀 화면이 보여 줄 것. */
const session = { canContinue: null, notices: [], lastRun: null };
function refreshSession() {
  const run = loaded.run.result;
  const progress = run.status === 'exact' ? run.state.run : run.status === 'salvage' ? run.core.run : null;
  session.canContinue = progress ? { floor: progress.floor, level: progress.level } : null;
  session.notices = [];
  if (!store.persistent) session.notices.push('이 브라우저에서는 진행이 저장되지 않습니다. 페이지를 닫으면 사라집니다.');
  if (loaded.run.primaryIssue && loaded.run.source === 'backup') session.notices.push('세이브가 손상되어 바로 앞의 저장본으로 되돌렸습니다.');
  else if (run.status === 'salvage' && run.damaged) session.notices.push('세이브 일부가 손상되었습니다. 이어하면 그 층을 처음부터 다시 시작합니다.');
  else if (loaded.run.primaryIssue && loaded.run.source === 'none') session.notices.push('세이브가 손상되어 이어할 수 없습니다.');
  if (loaded.meta.primaryIssue && loaded.meta.source === 'default') session.notices.push('영구 해금 기록을 읽지 못했습니다.');
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
  audio.setMusic(world ? world.zoneId : null, world ? world.kind !== 'normal' : false);
}

const ui = createUI({
  root: document.getElementById('ui'),
  getGame: () => game,
  getSettings: () => settings,
  getSession: () => session,
  actions: {
    newGame() {
      game = createGame({ seed: params.get('seed') || newSeed(), meta: game.state.meta, bus });
      enterFloor(game, 1);
      setPhase(game, PHASE.PLAYING);
      ui.screens.close();
    },
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
      if (resumed.mode === 'rebuilt' && loaded.run.result.damaged) ui.toast('세이브가 손상되어 이 층을 처음부터 다시 시작합니다');
      startMusic();
      ui.screens.close(); // 닫히면서 PAUSED → PLAYING
      if (game.state.phase !== PHASE.PLAYING) setPhase(game, PHASE.PLAYING);
      ui.syncVisibility();
    },
    /** 저장하고 타이틀로. 끝난 런이면 메타만 저장된다. */
    toTitle() {
      autosave.saveNow('title');
      const meta = game.state.meta;
      loaded = store.load();
      game = lobby(meta);
      refreshSession();
      audio.setMusic(null);
      ui.screens.open('title');
    },
    pause: () => setPhase(game, PHASE.PAUSED),
    resume: () => setPhase(game, PHASE.PLAYING),
    descend() {
      const result = descendStairs(game);
      if (!result.ok) ui.toast(reasonText(result.reason));
    },
    setSetting(key, value) {
      settings = withSetting(settings, key, value);
      store.saveSettings(settings);
      if (key === 'quality') renderer.setQuality(value);
      audio.setVolumes(settings);
      ui.applySettings();
    },
    /** 영구 해금을 샀다: 곧바로 저장한다(런 밖에서는 자동 저장이 돌지 않는다). */
    metaChanged: () => store.saveMeta(game.state.meta),
    sound: (name) => audio.play(name),
  },
});
ui.attach(bus);
bus.on(EVENTS.RUN_ENDED, (e) => {
  session.lastRun = e;
});
ui.screens.open('title');

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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    ui.resetInput();
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
 * 틱이 예외를 던졌을 때: 핵심(시드·진행도·인벤토리)만 건져 그 층을 다시 차리고, 그것도 안 되면 타이틀로 돌아간다.
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
    ui.toast('문제가 생겨 이 층을 처음부터 다시 시작합니다');
  } else {
    const meta = game.state.meta;
    game = lobby(meta);
    ui.screens.open('title');
    ui.toast('문제가 생겨 런을 이어갈 수 없습니다');
  }
  ui.syncVisibility();
}

function frame(now) {
  const elapsed = lastTime === null ? 0 : now - lastTime;
  lastTime = now;
  const input = ui.takeInput();
  if (game.state.phase === PHASE.PLAYING) {
    // 기술·회피는 누른 프레임에만 넘긴다. 매번 "없음"을 넘기면 아직 처리되지 않은 입력을 지워 버린다.
    const next = { moveX: input.moveX, moveY: input.moveY, attack: input.attack };
    if (input.skill >= 0) next.skill = input.skill;
    if (input.dodge) next.dodge = true;
    setInput(game.state, next);
  }
  let alpha = 0;
  try {
    ({ alpha } = loop.advance(elapsed));
  } catch (err) {
    recover(err);
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
  };
}
