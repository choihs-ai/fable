// 화면들: 타이틀, 일시정지, 설정, 가방, 상점, 제단, 강화 3택1, 결과(사망·승리), 영구 해금.
// 화면은 상태를 읽어 그리고, 바꾸는 일은 명령(logic/commands.js)과 main.js 가 준 actions 로만 한다.

import { CONSUMABLES } from '../../data/consumables.js';
import { RARITY, SLOTS, SLOT_NAMES, STATS } from '../../data/items.js';
import { UNLOCKS } from '../../data/meta.js';
import { SETTINGS } from '../../data/settings.js';
import { ZONES } from '../../data/zones.js';
import {
  acceptAltar, buyItem, buyUnlock, chooseUpgrade, compareItem, discardItem, equipItem, sellItem, unequipItem, useConsumable,
} from '../logic/commands.js';
import { PHASE } from '../logic/core/state.js';
import { getPlayer } from '../logic/entities/actors.js';
import { canAccept } from '../logic/items/altar.js';
import { sellPrice } from '../logic/items/equipment.js';
import { xpToNext } from '../logic/items/levelup.js';
import { canUnlock } from '../logic/items/meta.js';
import { h } from './dom.js';
import {
  altarCostText, altarRewardText, choiceText, consumableText, itemLines, itemMeta, itemName, reasonText, relicText, statText, unlockText,
} from './text.js';

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
  /** 가방에서 고른 것: { where:'bag'|'slot', key } */
  let picked = null;
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
  const button = (label, onclick, extra = {}) => h('button', { class: `btn ${extra.class ?? ''}`, disabled: extra.disabled, onclick: () => onclick() }, label);
  const panel = (title, ...children) => h('div', { class: 'panel' }, h('h2', { text: title }), ...children);
  const itemCard = (item, attrs = {}) => h('div', { class: `item rarity-${item.rarity} ${attrs.class ?? ''}`, onclick: attrs.onclick },
    h('div', { class: 'item-name', text: itemName(item) }), h('div', { class: 'item-meta', text: itemMeta(item) }));

  // ── 타이틀 ──
  function title() {
    const session = ctx.getSession();
    const cont = session.canContinue;
    return h('div', { class: 'panel title' },
      h('h1', { text: 'FABLE' }),
      h('p', { class: 'sub', text: '30층 아래의 군주를 쓰러뜨려라' }),
      button(cont ? `이어하기 — ${cont.floor}층 · 레벨 ${cont.level}` : '이어하기', () => ctx.actions.continueGame(), { class: 'primary', disabled: !cont }),
      button('새 게임', () => {
        if (cont && !confirmNew) {
          confirmNew = true;
          ctx.toast('진행 중인 런이 사라집니다. 한 번 더 누르면 새로 시작합니다');
          return;
        }
        confirmNew = false;
        ctx.actions.newGame();
      }),
      button(`영구 해금 (영혼석 ${state().meta.souls})`, () => open('unlocks', 'title')),
      button('설정', () => open('settings', 'title')),
      ...session.notices.map((text) => h('p', { class: 'notice', text })));
  }

  // ── 일시정지 ──
  function pause() {
    return panel('일시정지',
      button('계속하기', () => close(), { class: 'primary' }),
      button('가방', () => open('inventory', 'pause')),
      button('설정', () => open('settings', 'pause')),
      button('저장하고 타이틀로', () => ctx.actions.toTitle()));
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
        }, { class: values[key] ? 'on' : '' });
      } else {
        control = h('span', { class: 'choices' }, rule.values.map((v) => button(QUALITY_LABELS[v] ?? v, () => {
          ctx.actions.setSetting(key, v);
          render();
        }, { class: values[key] === v ? 'on' : '' })));
      }
      return h('div', { class: 'row', 'data-row': key }, h('label', { text: SETTING_LABELS[key] ?? key }), control);
    });
    return panel('설정', ...rows, button('닫기', () => close(), { class: 'primary' }));
  }

  // ── 가방 ──
  function inventory() {
    const { inventory: inv, run: runState } = state();
    const player = getPlayer(state());
    const sheet = runState.sheet ?? {};
    const pick = (where, key) => () => {
      picked = picked && picked.where === where && picked.key === key ? null : { where, key };
      render();
    };
    const slots = h('div', { class: 'slots' }, SLOTS.map((slot) => {
      const item = inv.equipped[slot];
      const on = picked && picked.where === 'slot' && picked.key === slot ? 'picked' : '';
      return item
        ? itemCard(item, { class: `slot ${on}`, onclick: pick('slot', slot) })
        : h('div', { class: 'item empty slot' }, h('div', { class: 'item-meta', text: SLOT_NAMES[slot] }));
    }));
    const bag = h('div', { class: 'bag' },
      inv.bag.map((item, i) => itemCard(item, { class: picked && picked.where === 'bag' && picked.key === i ? 'picked' : '', onclick: pick('bag', i) })),
      Array.from({ length: Math.max(0, inv.capacity - inv.bag.length) }, () => h('div', { class: 'item empty' })));

    let detail = h('p', { class: 'hint', text: '장비를 누르면 자세히 봅니다' });
    const item = picked ? (picked.where === 'bag' ? inv.bag[picked.key] : inv.equipped[picked.key]) : null;
    if (!item) picked = null;
    else {
      const lines = itemLines(item).map((text) => h('li', { text }));
      const actions = [];
      if (picked.where === 'bag') {
        const cmp = compareItem(game(), picked.key);
        const delta = cmp.ok ? Object.keys(cmp.delta).map((key) => h('li', { class: cmp.delta[key] > 0 ? 'up' : 'down', text: statText(key, cmp.delta[key]) })) : [];
        if (delta.length > 0) lines.push(h('li', { class: 'compare-title', text: '착용하면' }), ...delta);
        const index = picked.key;
        actions.push(button('착용', () => {
          picked = null;
          run(equipItem(game(), index));
        }, { class: 'primary' }), button('버리기', () => {
          picked = null;
          run(discardItem(game(), index));
        }));
      } else {
        const slot = picked.key;
        actions.push(button('해제', () => {
          picked = null;
          run(unequipItem(game(), slot));
        }));
      }
      detail = h('div', { class: `detail rarity-${item.rarity}` }, h('div', { class: 'item-name', text: itemName(item) }), h('div', { class: 'item-meta', text: itemMeta(item) }),
        h('ul', {}, lines), h('div', { class: 'actions' }, actions));
    }

    const potions = Object.keys(inv.consumables).map((id) => {
      const t = consumableText(id);
      return h('div', { class: 'row' }, h('label', {}, `${t.name} ×${inv.consumables[id]}`, h('small', { text: t.desc })), button('사용', () => run(useConsumable(game(), id))));
    });
    const relics = inv.relics.map((id) => {
      const t = relicText(id);
      return h('div', { class: 'row' }, h('label', {}, t.name, h('small', { text: t.desc })));
    });
    const stats = Object.keys(STATS).filter((key) => sheet[key]).map((key) => h('li', { text: statText(key, sheet[key]) }));
    return panel(`가방 (${inv.bag.length}/${inv.capacity})`,
      h('div', { class: 'summary', text: `체력 ${player ? player.hp : 0}/${player ? player.maxHp : 0} · 레벨 ${runState.level} (${runState.xp}/${xpToNext(runState.level)}) · 금화 ${inv.gold}` }),
      slots, bag, detail,
      potions.length > 0 ? h('h3', { text: '소비 아이템' }) : null, ...potions,
      relics.length > 0 ? h('h3', { text: '유물' }) : null, ...relics,
      stats.length > 0 ? h('h3', { text: '능력치' }) : null, h('ul', { class: 'stats' }, stats),
      button('닫기', () => close(), { class: 'primary' }));
  }

  // ── 상점 ──
  function shop() {
    const { shop: shopState, inventory: inv } = state();
    if (!shopState) return panel('상점', h('p', { text: '이 층에는 상점이 없습니다' }), button('닫기', () => close()));
    const stock = shopState.stock.map((entry, i) => {
      let name;
      let desc;
      if (entry.kind === 'equipment') {
        name = `${itemName(entry.item)} (${RARITY[entry.item.rarity].name})`;
        desc = itemLines(entry.item).join(', ');
      } else {
        const t = entry.kind === 'consumable' ? consumableText(entry.id) : relicText(entry.id);
        name = entry.kind === 'relic' ? `유물: ${t.name}` : t.name;
        desc = t.desc;
      }
      return h('div', { class: `row ${entry.sold ? 'sold' : ''}` }, h('label', {}, name, h('small', { text: desc })),
        button(entry.sold ? '팔림' : `${entry.price} 금화`, () => run(buyItem(game(), i)), { disabled: entry.sold || inv.gold < entry.price }));
    });
    const sell = inv.bag.map((item, i) => h('div', { class: 'row' }, h('label', {}, `${itemName(item)} (${RARITY[item.rarity].name})`, h('small', { text: itemLines(item).join(', ') })),
      button(`+${sellPrice(item)} 금화`, () => run(sellItem(game(), i)))));
    return panel(`상점 — 금화 ${inv.gold}`, h('h3', { text: '사기' }), ...stock,
      h('h3', { text: '팔기' }), ...(sell.length > 0 ? sell : [h('p', { class: 'hint', text: '가방에 팔 장비가 없습니다' })]),
      button('닫기', () => close(), { class: 'primary' }));
  }

  // ── 제단 ──
  function altar() {
    const { altar: altarState, inventory: inv } = state();
    const player = getPlayer(state());
    if (!altarState) return panel('제단', h('p', { text: '이 층에는 제단이 없습니다' }), button('닫기', () => close()));
    if (altarState.used) return panel('제단', h('p', { text: '제단의 힘이 다했습니다' }), button('닫기', () => close(), { class: 'primary' }));
    const offers = altarState.offers.map((offer, i) => {
      const can = canAccept(altarState, i, { hp: player.hp, maxHp: player.maxHp, gold: inv.gold });
      return h('div', { class: 'card' }, h('div', { class: 'cost', text: `대가: ${altarCostText(offer.cost)}` }), h('div', { class: 'reward', text: `보상: ${altarRewardText(offer.reward)}` }),
        button(can.ok ? '바친다' : reasonText(can.reason), () => {
          const result = run(acceptAltar(game(), i));
          // 강화를 받았으면 3택1 로 넘어간다.
          if (result.ok && state().run.choice) open('levelup', null);
        }, { disabled: !can.ok }));
    });
    return panel('제단 — 하나만 고를 수 있다', h('div', { class: 'cards' }, offers), button('그냥 간다', () => close()));
  }

  // ── 강화 3택1 ──
  function levelup() {
    const { run: runState } = state();
    if (!runState.choice) return null;
    const cards = runState.choice.options.map((option, i) => {
      const t = choiceText(option, runState.upgrades);
      return h('button', { class: `card choice ${option.kind}`, onclick: () => {
        run(chooseUpgrade(game(), i));
        if (!state().run.choice) close();
      } }, h('div', { class: 'item-name', text: t.name }), h('div', { class: 'desc', text: t.desc }), h('div', { class: 'item-meta', text: t.note }));
    });
    const more = runState.pendingChoices > 0 ? ` (뒤에 ${runState.pendingChoices}번 더)` : '';
    return panel(`레벨 ${runState.level} — 강화를 하나 고른다${more}`, h('div', { class: 'cards' }, cards));
  }

  // ── 결과 ──
  function result() {
    const { run: runState, meta, phase } = state();
    const info = ctx.getSession().lastRun;
    const win = phase === PHASE.VICTORY;
    const zone = ZONES[Math.min(ZONES.length - 1, Math.floor((runState.floor - 1) / 5))];
    return panel(win ? '심연의 군주를 쓰러뜨렸다' : '쓰러졌다',
      h('p', { text: `${runState.floor}층 (${zone.name}) · 레벨 ${runState.level} · 처치 ${runState.kills} · 보스 ${runState.bossKills}` }),
      h('p', { class: 'souls', text: `영혼석 +${info ? info.souls : 0} (보유 ${meta.souls})` }),
      button('영구 해금', () => open('unlocks', 'result'), { class: 'primary' }),
      button('타이틀로', () => ctx.actions.toTitle()));
  }

  // ── 영구 해금 ──
  function unlocks() {
    const { meta } = state();
    const rows = Object.keys(UNLOCKS).map((id) => {
      const t = unlockText(id);
      const owned = meta.unlocked[id] === true;
      const can = canUnlock(meta, id);
      const label = owned ? '해금됨' : can.ok ? `${t.cost} 영혼석` : can.reason === 'locked' ? `먼저: ${t.requires}` : `${t.cost} 영혼석`;
      return h('div', { class: `row ${owned ? 'owned' : ''}`, 'data-unlock': id }, h('label', {}, t.name, h('small', { text: t.desc })),
        button(label, () => {
          const bought = run(buyUnlock(game(), id));
          if (bought.ok) ctx.actions.metaChanged();
        }, { disabled: owned || !can.ok }));
    });
    return panel(`영구 해금 — 영혼석 ${meta.souls}`, h('p', { class: 'hint', text: `런 ${meta.runs}회 · 승리 ${meta.victories}회 · 최고 ${meta.bestFloor}층` }), ...rows, button('닫기', () => close(), { class: 'primary' }));
  }

  const BUILDERS = { title, pause, settings, inventory, shop, altar, levelup, result, unlocks };

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
    picked = null;
    confirmNew = false;
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
    /** 지금 화면을 다시 그린다(인벤토리가 바뀌었을 때 등). */
    refresh: render,
    get current() {
      return current;
    },
    /** 소비 아이템 이름표(HUD 의 물약 버튼용). */
    consumableName: (id) => CONSUMABLES[id].name,
  };
}
