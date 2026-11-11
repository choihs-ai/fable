// 브라우저 진입점(조립 지점). 로직·렌더·UI·저장을 만들어 서로 연결하는 유일한 곳이다.

import { LOOP, RENDER } from '../data/config.js';
import { EventBus } from './logic/core/event-bus.js';
import { EVENTS } from './logic/core/events.js';
import { FixedStepLoop } from './logic/core/loop.js';
import { PHASE } from './logic/core/state.js';
import { createGame, enterFloor, rescueGame, resumeGame, setPhase, tick } from './logic/game.js';
import { createRenderer } from './render/renderer.js';
import { bindLifecycle, createAutosave } from './save/autosave.js';
import { createSaveStore } from './save/save-store.js';
import { openStorage } from './save/storage.js';
import { createDebugOverlay } from './ui/debug-overlay.js';

// 시드: ?seed=... 로 지정하면 저장된 런을 이어하지 않고 그 시드로 새 런을 시작한다(같은 런을 재현할 때 쓴다).
// 없으면 시각에서 만든다. 게임에 들어오는 비결정적 값은 여기 한 곳뿐이고, 이후 난수는 전부 시드 PRNG 에서 나온다.
const params = new URLSearchParams(window.location.search);
const newSeed = () => Date.now().toString(36);

// ── 저장 ─────────────────────────────────────────────────────────────────────
// localStorage 를 쓸 수 없으면 메모리 저장소로 대체된다(store.persistent 가 false). 게임은 그대로 돌아간다.
const store = createSaveStore({ storage: openStorage(() => window.localStorage), now: () => Date.now() });
const loaded = store.load();
// TODO(ui·audio 단계): 설정(loaded.settings.settings)을 쓰는 곳이 아직 없다. 설정 화면에서 withSetting 으로 바꾸고 store.saveSettings 로 저장한다.

const bus = new EventBus();
bus.onError = (err, type) => console.error(`[event ${type}]`, err);

let game = null;
/** 디버그 표시에 덧붙일 저장 상태. */
let saveNote = store.persistent ? '' : `저장 불가(${store.storageIssue})`;

const autosave = createAutosave({
  getGame: () => game,
  store,
  onResult: ({ trigger, run }) => {
    if (run.ok) saveNote = `저장됨(${trigger}, ${run.length}자)${store.persistent ? '' : ' — 메모리에만'}`;
    else if (run.reason !== 'run-ended' && run.reason !== 'not-started') {
      saveNote = `저장 실패(${run.reason})`;
      console.warn('[save]', trigger, run.reason, run.problems ?? run.error ?? '');
    }
  },
});
autosave.attach(bus);
bus.on(EVENTS.GAME_RESTORED, ({ mode }) => {
  saveNote = mode === 'exact' ? '이어하기' : '이어하기(층을 다시 만듦)';
});

/** 새 런을 시작한다. 메타는 지금까지 쌓인 것을 이어 쓴다. */
function startNewRun(seed, meta) {
  game = createGame({ seed, meta, bus });
  enterFloor(game, 1);
}

// 저장된 런이 있으면 이어하고, 없거나 읽지 못하면 새 런을 시작한다. 어떤 세이브가 들어 있어도 여기서 멈추지 않는다.
if (!params.has('seed')) {
  try {
    const resumed = resumeGame({ run: loaded.run.result, meta: loaded.meta.meta, bus });
    if (resumed) game = resumed.game;
  } catch (err) {
    console.error('[save] 이어하기 실패 — 새 런을 시작합니다', err);
    game = null;
  }
}
if (loaded.run.primaryIssue) console.warn(`[save] 런 세이브를 그대로 쓰지 못했습니다(${loaded.run.primaryIssue}) → ${loaded.run.source}`);
if (loaded.meta.primaryIssue) console.warn(`[save] 메타 세이브를 그대로 쓰지 못했습니다(${loaded.meta.primaryIssue}) → ${loaded.meta.source}`);
if (!game) startNewRun(params.get('seed') || newSeed(), loaded.meta.meta);
// TODO(ui 단계): 타이틀 화면이 생기면 "이어하기 / 새 게임"을 고르게 하고, 곧바로 PLAYING 으로 넘기지 않는다.
setPhase(game, PHASE.PLAYING);

// 백그라운드 전환·페이지를 닫을 때 저장한다.
bindLifecycle({ doc: document, win: window, autosave });

// ── 렌더·루프 ────────────────────────────────────────────────────────────────
const renderer = createRenderer({ canvas: document.getElementById('scene'), config: RENDER });
const overlay = createDebugOverlay({ element: document.getElementById('debug') });

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

const loop = new FixedStepLoop({
  stepMs: 1000 / LOOP.tickRate,
  maxFrameMs: LOOP.maxFrameMs,
  update: (dtSec) => tick(game, dtSec),
});

/**
 * 틱이 예외를 던졌을 때: 핵심(시드·진행도·인벤토리)만 건져 그 층을 다시 차리고, 그것도 안 되면 새 런을 시작한다.
 * 같은 일이 거듭되면 멈춰 둔다(무한 반복 방지).
 */
let crashes = 0;
function recover(err) {
  crashes++;
  console.error(`[tick] 예외 ${crashes}회`, err);
  if (crashes > 3) {
    try {
      setPhase(game, PHASE.PAUSED);
    } catch (inner) {
      console.error('[tick] 멈추지 못함', inner);
    }
    saveNote = '오류로 멈춤';
    return;
  }
  const meta = game.state.meta;
  let rescued = null;
  try {
    rescued = rescueGame(game);
  } catch (inner) {
    console.error('[tick] 복구 실패', inner);
  }
  if (rescued) game = rescued;
  else startNewRun(newSeed(), meta);
  setPhase(game, PHASE.PLAYING);
}

let lastTime = null;
function frame(now) {
  const elapsed = lastTime === null ? 0 : now - lastTime;
  lastTime = now;
  let alpha = 0;
  try {
    ({ alpha } = loop.advance(elapsed));
  } catch (err) {
    recover(err);
  }
  autosave.flush();
  renderer.render(game.state, alpha);
  overlay.update(game.state, saveNote);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
