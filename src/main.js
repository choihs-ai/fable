// 브라우저 진입점(조립 지점). 로직·렌더·UI 를 만들어 서로 연결하는 유일한 곳이다.

import { LOOP, RENDER } from '../data/config.js';
import { FixedStepLoop } from './logic/core/loop.js';
import { PHASE } from './logic/core/state.js';
import { createGame, setPhase, tick } from './logic/game.js';
import { createRenderer } from './render/renderer.js';
import { createDebugOverlay } from './ui/debug-overlay.js';

// 시드: ?seed=... 로 지정하면 같은 런을 재현한다. 없으면 시각에서 만든다.
// 게임에 들어오는 비결정적 값은 여기 한 곳뿐이고, 이후 난수는 전부 시드 PRNG 에서 나온다.
const params = new URLSearchParams(window.location.search);
const seed = params.get('seed') || Date.now().toString(36);

const game = createGame({ seed });
game.bus.onError = (err, type) => console.error(`[event ${type}]`, err);

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

// TODO(ui 단계): 타이틀 화면이 생기면 바로 PLAYING 으로 넘어가지 않는다.
setPhase(game, PHASE.PLAYING);

let lastTime = null;
function frame(now) {
  const elapsed = lastTime === null ? 0 : now - lastTime;
  lastTime = now;
  const { alpha } = loop.advance(elapsed);
  renderer.render(game.state, alpha);
  overlay.update(game.state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
