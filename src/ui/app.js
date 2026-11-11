// ui 의 조립: HUD, 조작부, 화면들을 만들고 서로 잇는다. main.js 는 이 파일만 상대한다.
//
// 흐름
//   - 화면(가방·상점·설정 등)이 열리면 게임을 멈추고(actions.pause) 조작을 끈다. 닫히면 다시 켠다.
//   - 강화 후보가 제시돼 있으면 3택1 화면을 띄운다(세이브에서 이어한 경우에도).
//   - 런이 끝나면 결과 화면을 띄운다.

import { EVENTS } from '../logic/core/events.js';
import { PHASE } from '../logic/core/state.js';
import { useConsumable } from '../logic/commands.js';
import { h } from './dom.js';
import { createHaptics } from './haptics.js';
import { createHud } from './hud.js';
import { createTouchPad } from './input/touch-pad.js';
import { createScreens } from './screens.js';
import { itemName, reasonText } from './text.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {() => { state:object, bus:object }} options.getGame
 * @param {() => object} options.getSettings
 * @param {() => object} options.getSession { canContinue, notices, lastRun }
 * @param {object} options.actions main.js 가 해 주는 일: newGame, continueGame, toTitle, pause, resume, descend, setSetting, metaChanged, sound(name)
 */
export function createUI({ root, getGame, getSettings, getSession, actions }) {
  const haptics = createHaptics();
  const layer = h('div', { class: 'screens' });
  const pad = createTouchPad({ root, sensitivity: getSettings().sensitivity });
  const hud = createHud({
    root,
    on: {
      pause: () => screens.open('pause'),
      bag: () => screens.open('inventory'),
      potion: (id) => {
        const result = useConsumable(getGame(), id);
        if (!result.ok) hud.toast(reasonText(result.reason));
        else actions.sound('potion');
      },
      context: (kind) => {
        if (kind === 'stairs') actions.descend();
        else if (kind === 'locked') hud.toast(reasonText('boss-alive'));
        else if (kind === 'shop' || kind === 'altar') screens.open(kind);
      },
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
      const offs = [
        bus.on(EVENTS.INVENTORY_CHANGED, () => {
          if (screens.current === 'inventory' || screens.current === 'shop') screens.refresh();
        }),
        bus.on(EVENTS.RUN_ENDED, ({ victory }) => {
          haptics.pulse('death');
          screens.open('result');
          hud.toast(victory ? '승리!' : '쓰러졌다');
        }),
        bus.on(EVENTS.DAMAGE_DEALT, ({ targetId, amount }) => {
          if (targetId === getGame().state.playerId && amount > 0) haptics.pulse('hurt');
        }),
        bus.on(EVENTS.ENTITY_DIED, ({ kind }) => {
          if (kind !== 'player') haptics.pulse('kill');
        }),
        bus.on(EVENTS.LEVEL_UP, () => haptics.pulse('levelUp')),
        bus.on(EVENTS.DROP_COLLECTED, ({ kind, uid }) => {
          if (kind !== 'equipment') return;
          const item = getGame().state.inventory.bag.find((it) => it.uid === uid);
          if (item) hud.toast(`${itemName(item)} 획득`);
        }),
        bus.on(EVENTS.FLOOR_ENTERED, ({ floor }) => hud.toast(`${floor}층`)),
        bus.on(EVENTS.PLAYER_REVIVED, () => hud.toast('불사조의 깃털이 타올랐다')),
      ];
      return () => offs.forEach((off) => off());
    },
    /** 프레임마다: HUD·조작부를 갱신하고, 띄워야 할 화면이 있으면 띄운다. */
    update() {
      const game = getGame();
      const { state } = game;
      if (state.world && state.phase === PHASE.PLAYING && state.run.choice && screens.current === null) screens.open('levelup');
      pad.draw(hud.update(game));
    },
  };
}
