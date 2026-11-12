// ui 의 조립: HUD, 조작부, 화면들을 만들고 서로 잇는다. main.js 는 이 파일만 상대한다.
//
// 흐름
//   - 화면(일시정지·상점·설정 등)이 열리면 게임을 멈추고(actions.pause) 조작을 끈다. 닫히면 다시 켠다.
//   - 축복 3택1 이 제시돼 있으면 그 화면을 띄운다(세이브에서 이어한 경우에도 — 이벤트가 아니라 상태를 본다).
//   - 런이 끝나면 결과 화면을 띄운다.

import { EVENTS } from '../logic/core/events.js';
import { PHASE } from '../logic/core/state.js';
import { h } from './dom.js';
import { createHaptics } from './haptics.js';
import { createHud } from './hud.js';
import { guardGestures } from './input/gesture-guard.js';
import { createTouchPad } from './input/touch-pad.js';
import { createScreens } from './screens.js';
import { REWARD_NAMES, boonName, weaponName } from './text.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {() => { state:object, bus:object }} options.getGame
 * @param {() => object} options.getSettings
 * @param {() => object} options.getSession { canContinue, notices, lastRun }
 * @param {object} options.actions main.js 가 해 주는 일: newGame(character), continueGame, retry, toHub, toTitle, pause, resume,
 *   interact, swap, setSetting, metaChanged, sound(name)
 */
export function createUI({ root, getGame, getSettings, getSession, actions }) {
  const haptics = createHaptics();
  const guard = guardGestures(document);
  const layer = h('div', { class: 'screens' });
  const pad = createTouchPad({ root, sensitivity: getSettings().sensitivity });
  const hud = createHud({
    root,
    on: {
      pause: () => screens.open('pause'),
      swap: () => actions.swap(),
    },
  });
  root.append(layer);

  const screens = createScreens({
    layer,
    ctx: {
      getGame,
      getSettings,
      getSession,
      toast: (text) => hud.toast(text),
      actions: {
        ...actions,
        feedback(kind) {
          actions.sound(kind);
          if (kind === 'deny') haptics.pulse('deny');
        },
        /** 화면이 열리고 닫힐 때: 게임을 멈추고 조작을 끈다 / 다시 켠다. */
        screenChanged(name) {
          const { state } = getGame();
          if (name !== null) {
            pad.setEnabled(false);
            if (state.phase === PHASE.PLAYING) actions.pause();
          } else if (state.phase === PHASE.PAUSED && !state.run.ended) actions.resume();
          syncVisibility();
        },
      },
    },
  });

  function syncVisibility() {
    const { state } = getGame();
    const inRun = state.world !== null && state.phase !== PHASE.TITLE;
    hud.setVisible(inRun);
    pad.setEnabled(inRun && state.phase === PHASE.PLAYING && screens.current === null);
  }

  function applySettings() {
    const settings = getSettings();
    haptics.setEnabled(settings.vibration);
    pad.setSensitivity(settings.sensitivity);
    pad.setLeftHanded(settings.leftHanded);
    root.classList.toggle('left-handed', settings.leftHanded);
  }
  applySettings();

  return {
    screens,
    pad,
    hud,
    haptics,
    guard,
    toast: (text) => hud.toast(text),
    applySettings,
    syncVisibility,
    /** 쥐고 있던 입력을 모두 놓는다(백그라운드 전환, 화면 회전). */
    resetInput: () => pad.reset(),
    /** 이번 프레임의 입력. */
    takeInput: () => pad.take(),
    /**
     * 이벤트버스에 연결한다. @returns {() => void}
     */
    attach(bus) {
      const isPlayer = (id) => id === getGame().state.playerId;
      const offs = [
        bus.on(EVENTS.RUN_ENDED, ({ victory }) => {
          haptics.pulse('death');
          screens.open('result');
          hud.toast(victory ? '탈출 성공!' : '쓰러졌다');
        }),
        bus.on(EVENTS.DAMAGE_DEALT, ({ targetId, sourceId, amount, crit }) => {
          if (amount <= 0) return;
          if (isPlayer(targetId)) haptics.pulse('hurt');
          else if (isPlayer(sourceId)) haptics.pulse(crit ? 'crit' : 'hit');
        }),
        bus.on(EVENTS.ENTITY_DIED, ({ kind }) => {
          if (kind !== 'player') haptics.pulse('kill');
        }),
        bus.on(EVENTS.PLAYER_DASHED, () => haptics.pulse('dash')),
        bus.on(EVENTS.SKILL_USED, () => haptics.pulse('skill')),
        bus.on(EVENTS.DOORS_LOCKED, () => {
          haptics.pulse('door');
          hud.banner('문이 잠겼다!', 'lock');
        }),
        bus.on(EVENTS.WAVE_STARTED, ({ wave, waves }) => {
          if (wave > 0) hud.banner(`웨이브 ${wave + 1}/${waves}`, 'wave');
        }),
        bus.on(EVENTS.ROOM_CLEARED, ({ kind, reward }) => {
          haptics.pulse('clear');
          hud.banner(kind === 'boss' ? '보스 처치!' : `방 정리 — ${REWARD_NAMES[reward] ?? ''}`, 'clear');
        }),
        bus.on(EVENTS.BOON_CHOSEN, ({ boon }) => {
          haptics.pulse('boon');
          hud.toast(`축복: ${boonName(boon)}`);
        }),
        bus.on(EVENTS.WEAPON_PICKED, ({ weapon }) => hud.toast(`${weaponName(weapon)} 장착`)),
        bus.on(EVENTS.ENERGY_EMPTY, () => hud.toast('에너지가 모자랍니다 — 근접 무기로 바꾸거나 구슬을 주우세요')),
        bus.on(EVENTS.SECRET_FOUND, () => hud.banner('숨은 길을 찾았다!', 'clear')),
        bus.on(EVENTS.BOSS_PHASE_CHANGED, () => haptics.pulse('bossPhase')),
        bus.on(EVENTS.DROP_COLLECTED, ({ kind }) => {
          if (kind === 'gold' || kind === 'energy' || kind === 'health') haptics.pulse('pickup');
        }),
        bus.on(EVENTS.PLAYER_REVIVED, () => hud.toast('두 번째 바람이 불었다')),
      ];
      return () => offs.forEach((off) => off());
    },
    /** 프레임마다: HUD·조작부를 갱신하고, 띄워야 할 화면이 있으면 띄운다. */
    update() {
      const game = getGame();
      const { state } = game;
      if (state.world && state.phase === PHASE.PLAYING && state.run.choice && screens.current === null) screens.open('boon');
      pad.draw(hud.update(game));
    },
  };
}
