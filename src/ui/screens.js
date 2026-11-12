// 화면들: 타이틀, 캐릭터 고르기, 거점(영구 강화·캐릭터 해금), 축복 3택1, 상점, 일시정지, 설정, 결과(사망·승리).
// 화면은 상태를 읽어 그리고, 바꾸는 일은 명령(logic/commands.js)과 main.js 가 준 actions 로만 한다.

import { BOONS, BOON_RULES } from '../../data/boons.js';
import { CHARACTERS, CHARACTER_ORDER } from '../../data/characters.js';
import { UPGRADES } from '../../data/meta.js';
import { SETTINGS } from '../../data/settings.js';
import { WEAPONS } from '../../data/weapons.js';
import {
  boonRerollCost, buyMetaUpgrade, buyShopItem, chooseBoon, rerollBoons, rerollShop, shopPrice, unlockMetaCharacter,
} from '../logic/commands.js';
import { upgradeLevel } from '../logic/items/meta.js';
import { shopRerollCost } from '../logic/items/shop.js';
import { h } from './dom.js';
import { boonColor, boonFamily, boonName, characterName, reasonText, weaponMeta, weaponName } from './text.js';

const SETTING_LABELS = {
  masterVolume: '전체 음량', musicVolume: '배경음', sfxVolume: '효과음', vibration: '진동', quality: '그래픽 품질', leftHanded: '왼손 조작', sensitivity: '조이스틱 감도',
};
const QUALITY_LABELS = { low: '낮음', medium: '보통', high: '높음' };

/**
 * @param {object} options
 * @param {HTMLElement} options.layer 화면을 붙일 곳
 * @param {object} options.ctx { getGame, actions, getSettings, getSession, toast }
 */
export function createScreens({ layer, ctx }) {
  /** 지금 열린 화면 이름(없으면 null)과, 닫으면 돌아갈 화면. */
  let current = null;
  let returnTo = null;
  /** 진행 중인 런이 있을 때 "새 게임"은 두 번 눌러야 한다. */
  let confirmNew = false;

  const game = () => ctx.getGame();
  const state = () => game().state;

  /** 명령을 실행하고 화면을 다시 그린다. 거절되면 이유를 알린다. */
  function run(result) {
    if (!result.ok) {
      ctx.toast(reasonText(result.reason));
      ctx.actions.feedback('deny');
    } else ctx.actions.feedback('click');
    render();
    return result;
  }
  const button = (label, onclick, extra = {}) => h('button', { class: `btn ${extra.class ?? ''}`, disabled: extra.disabled, 'data-action': extra.action, onclick: () => onclick() }, label);
  const panel = (title, ...children) => h('div', { class: 'panel' }, h('h2', { text: title }), ...children);
  const souls = () => h('div', { class: 'souls', text: `영혼석 ${state().meta.souls}` });

  // ── 타이틀 ──
  function title() {
    const session = ctx.getSession();
    const cont = session.canContinue;
    return h('div', { class: 'panel title' },
      h('h1', { text: 'FABLE' }),
      h('p', { class: 'subtitle', text: '지하 묘지 — 맛보기 판' }),
      ...session.notices.map((n) => h('p', { class: 'notice', text: n })),
      cont ? button(`이어하기 · ${characterName(cont.character)} · 깬 방 ${cont.rooms}`, () => ctx.actions.continueGame(), { class: 'primary', action: 'continue' }) : null,
      button(cont && !confirmNew ? '새 게임' : cont ? '정말 새로 시작(진행 중인 판은 사라짐)' : '새 게임', () => {
        if (cont && !confirmNew) {
          confirmNew = true;
          render();
          return;
        }
        open('characters', 'title');
      }, { class: cont ? '' : 'primary', action: 'new' }),
      button('거점(영구 강화)', () => open('hub', 'title'), { action: 'hub' }),
      button('설정', () => open('settings', 'title'), { action: 'settings' }),
      souls());
  }

  // ── 캐릭터 고르기 ──
  function characters() {
    const meta = state().meta;
    const cards = CHARACTER_ORDER.map((id) => {
      const c = CHARACTERS[id];
      const owned = meta.characters[id] === true;
      return h('div', { class: `card character ${owned ? '' : 'locked'}`, 'data-character': id },
        h('h3', { text: c.name }),
        h('p', { text: c.desc }),
        h('p', { class: 'meta', text: `체력 ${c.hp} · 에너지 ${c.energy} · ${c.weapons.map(weaponName).join(' + ')}` }),
        h('p', { class: 'skill', text: `스킬: ${c.skill.name} — ${c.skill.desc}` }),
        owned
          ? button('이 캐릭터로 시작', () => ctx.actions.newGame(id), { class: 'primary', action: `start-${id}` })
          : button(`영혼석 ${c.cost}으로 해금`, () => {
            const result = run(unlockMetaCharacter(game(), id));
            if (result.ok) ctx.actions.metaChanged();
          }, { action: `unlock-${id}` }));
    });
    return panel('캐릭터', h('div', { class: 'cards' }, cards), souls(), button('돌아가기', () => close(), { action: 'back' }));
  }

  // ── 거점: 영구 강화 ──
  function hub() {
    const meta = state().meta;
    const rows = Object.keys(UPGRADES).map((id) => {
      const u = UPGRADES[id];
      const level = upgradeLevel(meta, id);
      const maxed = level >= u.cost.length;
      const cost = maxed ? null : u.cost[level];
      return h('div', { class: 'row upgrade', 'data-upgrade': id },
        h('div', { class: 'grow' }, h('b', { text: `${u.name} ${'●'.repeat(level)}${'○'.repeat(u.cost.length - level)}` }), h('small', { text: u.desc })),
        button(maxed ? '최대' : `${cost}`, () => {
          const result = run(buyMetaUpgrade(game(), id));
          if (result.ok) ctx.actions.metaChanged();
        }, { disabled: maxed || meta.souls < cost, class: 'buy', action: `buy-${id}` }));
    });
    const stats = h('p', { class: 'meta', text: `판 ${meta.runs} · 승리 ${meta.victories} · 가장 많이 깬 방 ${meta.bestRooms} · 처치 ${meta.totalKills}` });
    return panel('거점', souls(), h('div', { class: 'list scroll' }, rows), stats,
      button('캐릭터', () => open('characters', 'hub'), { action: 'characters' }),
      button('돌아가기', () => close(), { class: 'primary', action: 'back' }));
  }

  // ── 축복 3택1 ──
  function boon() {
    const { choice } = state().run;
    if (!choice) return null;
    const cost = boonRerollCost(state());
    const cards = choice.options.map((id, i) => {
      const b = BOONS[id];
      return h('div', { class: `card boon ${b.duo ? 'duo' : ''}`, style: `--c:${boonColor(id)}`, 'data-tap': '', 'data-boon': id, onclick: () => {
        const result = run(chooseBoon(game(), i));
        if (result.ok) close();
      } },
      h('small', { class: 'family', text: boonFamily(id) || '무계열' }),
      h('h3', { text: boonName(id) }),
      h('p', { text: b.desc }));
    });
    return panel('축복을 고르세요', h('div', { class: 'cards' }, cards),
      button(cost === 0 ? `다시 뽑기(무료 ${state().run.freeRerolls}회)` : `다시 뽑기 · 금화 ${cost}`, () => run(rerollBoons(game())), { disabled: state().run.gold < cost, action: 'reroll' }),
      h('p', { class: 'meta', text: `금화 ${state().run.gold} · 가진 축복 ${state().run.boons.length}개 · 계열 둘을 가지면 합성 축복이 나옵니다` }));
  }

  // ── 상점 ──
  function shop() {
    const s = state();
    if (!s.shop) return null;
    const rows = s.shop.stock.map((item, i) => {
      const price = shopPrice(s, item);
      let name;
      let desc;
      if (item.kind === 'weapon') {
        name = weaponName(item.weapon);
        desc = `${weaponMeta(item.weapon)} — ${WEAPONS[item.weapon].desc}`;
      } else if (item.kind === 'boon') {
        name = `축복: ${boonName(item.boon)}`;
        desc = `${boonFamily(item.boon) || '무계열'} — ${BOONS[item.boon].desc}`;
      } else {
        name = '회복';
        desc = '체력을 회복합니다. 살 때마다 비싸집니다.';
      }
      return h('div', { class: `row shop-item ${item.sold ? 'sold' : ''}`, 'data-item': i },
        h('div', { class: 'grow' }, h('b', { text: name }), h('small', { text: desc })),
        button(item.sold ? '팔림' : `${price}`, () => run(buyShopItem(game(), i)), { disabled: item.sold || s.run.gold < price, class: 'buy', action: `buy-${i}` }));
    });
    return panel('상점', h('div', { class: 'meta', text: `금화 ${s.run.gold}` }), h('div', { class: 'list scroll' }, rows),
      button(`진열품 다시 뽑기 · ${shopRerollCost(s.shop.rerolls)}`, () => run(rerollShop(game())), { disabled: s.run.gold < shopRerollCost(s.shop.rerolls), action: 'reroll' }),
      button('나가기', () => close(), { class: 'primary', action: 'back' }));
  }

  // ── 일시정지 ──
  function pause() {
    const s = state();
    const boons = s.run.boons.map((id) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', { text: boonName(id), style: `color:${boonColor(id)}` }), h('small', { text: BOONS[id].desc }))));
    return panel('일시정지',
      button('계속하기', () => close(), { class: 'primary', action: 'resume' }),
      button('설정', () => open('settings', 'pause'), { action: 'settings' }),
      button('저장하고 타이틀로', () => ctx.actions.toTitle(), { action: 'title' }),
      boons.length ? h('h3', { text: '가진 축복' }) : null,
      boons.length ? h('div', { class: 'list scroll' }, boons) : null);
  }

  // ── 설정 ──
  function settings() {
    const values = ctx.getSettings();
    const rows = Object.keys(SETTINGS).map((key) => {
      const rule = SETTINGS[key];
      let control;
      if (rule.type === 'int') {
        const out = h('span', { class: 'value', text: String(values[key]) });
        control = h('span', { class: 'range' }, h('input', {
          type: 'range', min: rule.min, max: rule.max, step: key === 'sensitivity' ? 10 : 5, value: values[key], 'data-setting': key,
          oninput: (e) => {
            out.textContent = e.target.value;
            ctx.actions.setSetting(key, Number(e.target.value));
          },
        }), out);
      } else if (rule.type === 'bool') {
        control = button(values[key] ? '켬' : '끔', () => {
          ctx.actions.setSetting(key, !values[key]);
          render();
        }, { class: values[key] ? 'on' : '', action: `toggle-${key}` });
      } else {
        control = h('span', { class: 'choices' }, rule.values.map((v) => button(QUALITY_LABELS[v] ?? v, () => {
          ctx.actions.setSetting(key, v);
          render();
        }, { class: values[key] === v ? 'on' : '', action: `${key}-${v}` })));
      }
      return h('div', { class: 'row', 'data-row': key }, h('label', { text: SETTING_LABELS[key] ?? key }), control);
    });
    return panel('설정', h('div', { class: 'list scroll' }, rows), button('닫기', () => close(), { class: 'primary', action: 'back' }));
  }

  // ── 결과 ──
  function result() {
    const last = ctx.getSession().lastRun;
    if (!last) return null;
    const s = state();
    return panel(last.victory ? '탈출 성공!' : '쓰러졌다',
      h('p', { class: 'meta', text: `깬 방 ${last.roomsCleared} · 처치 ${last.kills} · 정예 ${last.eliteKills} · 보스 ${last.bossKills}` }),
      h('p', { class: 'reward', text: `영혼석 +${last.souls}` }),
      h('p', { class: 'meta', text: `가진 영혼석 ${s.meta.souls} — 거점에서 영구 강화를 사거나 캐릭터를 해금할 수 있습니다` }),
      button('바로 다시 하기', () => ctx.actions.retry(), { class: 'primary', action: 'retry' }),
      button('거점으로', () => ctx.actions.toHub(), { action: 'hub' }),
      button('타이틀로', () => ctx.actions.toTitle(), { action: 'title' }));
  }

  const BUILDERS = { title, characters, hub, boon, shop, pause, settings, result };

  function render() {
    layer.replaceChildren();
    layer.classList.toggle('open', current !== null);
    if (current === null) return;
    const content = BUILDERS[current]();
    if (!content) {
      current = null;
      layer.classList.remove('open');
      ctx.actions.screenChanged(null);
      return;
    }
    content.dataset.screen = current;
    layer.append(content);
  }

  /** 화면을 연다. back 은 닫았을 때 돌아갈 화면(없으면 게임으로). */
  function open(name, back = null) {
    if (!BUILDERS[name]) throw new RangeError(`open: 알 수 없는 화면 "${name}"`);
    current = name;
    returnTo = back;
    if (name !== 'title') confirmNew = false;
    render();
    ctx.actions.screenChanged(name);
  }

  /** 화면을 닫는다. 돌아갈 화면이 있으면 그리로 간다. */
  function close() {
    const back = returnTo;
    current = null;
    returnTo = null;
    if (back) return open(back, null);
    render();
    ctx.actions.screenChanged(null);
    return undefined;
  }

  return {
    open,
    close,
    /** 돌아갈 화면을 무시하고 모두 닫는다(게임을 시작할 때). */
    closeAll() {
      returnTo = null;
      close();
    },
    /** 지금 화면을 다시 그린다(금화가 바뀌었을 때 등). */
    refresh: render,
    get current() {
      return current;
    },
  };
}

export { BOON_RULES };
