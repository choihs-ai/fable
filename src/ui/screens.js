// 화면들: 타이틀, 캐릭터 고르기, 거점(탈방 — 영구 강화·캐릭터 해금·저주), 축복 3택1, 상점, 일시정지, 설정, 결과(사망·승리), 이야기(쪽 넘기기).
// 화면은 상태를 읽어 그리고, 바꾸는 일은 명령(logic/commands.js)과 main.js 가 준 actions 로만 한다.

import { BOONS, BOON_RULES } from '../../data/boons.js';
import { CHARACTERS, CHARACTER_ORDER } from '../../data/characters.js';
import { ZONES } from '../../data/zones.js';
import { CURSE, UPGRADES } from '../../data/meta.js';
import { SETTINGS } from '../../data/settings.js';
import { STORY } from '../../data/story.js';
import { WEAPONS } from '../../data/weapons.js';
import {
  boonRerollCost, buyMetaUpgrade, buyShopItem, chooseBoon, rerollBoons, rerollShop, setMetaCurse, shopPrice, unlockMetaCharacter,
} from '../logic/commands.js';
import { upgradeLevel } from '../logic/items/meta.js';
import { shopRerollCost } from '../logic/items/shop.js';
import { h } from './dom.js';
import { familyIcon, icon, maskPortrait } from './icons.js';
import { boonColor, boonFamily, boonName, reasonText, weaponMeta, weaponName } from './text.js';

const SETTING_LABELS = {
  masterVolume: '소리 전체', musicVolume: '배경음', sfxVolume: '효과음', vibration: '진동', quality: '그림 품질', leftHanded: '왼손잡이', sensitivity: '스틱 감도',
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
  /** 이야기 화면: 쪽 목록, 지금 쪽, 다 보면 할 일. */
  let story = null;

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
  /** 버튼. label 은 글자이거나 요소들(아이콘 + 글자). */
  const button = (label, onclick, extra = {}) => h('button', { class: `btn ${extra.class ?? ''}`, disabled: extra.disabled, 'data-action': extra.action, onclick: () => onclick() }, label);
  /** 판: 머리띠(제목) + 내용. */
  const panel = (title, ...children) => h('div', { class: 'panel' }, h('h2', { class: 'ribbon', text: title }), ...children);
  const souls = () => h('div', { class: 'souls' }, icon('soul'), h('span', { class: 'num', text: String(state().meta.souls) }));
  /** 값 버튼: 아이콘 + 숫자. */
  const price = (name, amount) => [icon(name), h('span', { class: 'num', text: String(amount) })];
  /** 다섯 칸 눈금(탈의 능력치 비교). */
  const gauge = (label, value, values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const filled = max === min ? 3 : 1 + Math.round((4 * (value - min)) / (max - min));
    return h('div', { class: 'gauge' }, h('span', { text: label }), h('span', { class: 'ticks' }, Array.from({ length: 5 }, (_, i) => h('i', { class: i < filled ? 'on' : '' }))));
  };

  // ── 타이틀 ──
  function title() {
    const session = ctx.getSession();
    const cont = session.canContinue;
    return h('div', { class: 'title' },
      h('div', { class: 'parade' }, CHARACTER_ORDER.map((id) => maskPortrait(id, state().meta.characters[id] === true ? '' : 'locked'))),
      h('h1', { class: 'logo', text: 'FABLE' }),
      h('p', { class: 'strip', text: '도둑맞은 탈을 되찾으러, 여섯 층 아래로' }),
      ...session.notices.map((n) => h('p', { class: 'notice', text: n })),
      h('div', { class: 'menu' },
        cont ? button([maskPortrait(cont.character), h('span', { text: `이어하기 · ${cont.floor}층 ${ZONES[cont.floor - 1]?.name ?? ''}` })], () => ctx.actions.continueGame(), { class: 'primary', action: 'continue' }) : null,
        button(cont && !confirmNew ? '새 판' : cont ? '하던 판을 버리고 새 판' : '새 판', () => {
          if (cont && !confirmNew) {
            confirmNew = true;
            render();
            return;
          }
          // 아직 한 판도 끝내지 않았으면 이야기의 시작을 먼저 보여 준다.
          if (state().meta.runs === 0) showStory(STORY.prologue, () => open('characters', 'title'));
          else open('characters', 'title');
        }, { class: cont ? (confirmNew ? 'danger' : '') : 'primary', action: 'new' }),
        button('탈방', () => open('hub', 'title'), { action: 'hub' }),
        button('설정', () => open('settings', 'title'), { action: 'settings' })),
      souls());
  }

  // ── 탈 고르기 ──
  function characters() {
    const meta = state().meta;
    const all = CHARACTER_ORDER.map((id) => CHARACTERS[id]);
    const cards = CHARACTER_ORDER.map((id) => {
      const c = CHARACTERS[id];
      const owned = meta.characters[id] === true;
      return h('div', { class: `card mask-card ${owned ? '' : 'locked'}`, 'data-character': id },
        h('div', { class: 'head' }, maskPortrait(id), h('div', {}, h('h3', { text: c.name }), h('p', { text: c.desc }))),
        STORY.masks[id] ? h('p', { class: 'lore', text: STORY.masks[id] }) : null,
        h('div', { class: 'gauges' },
          gauge('체력', c.hp, all.map((x) => x.hp)), gauge('속도', c.speed, all.map((x) => x.speed)), gauge('에너지', c.energy, all.map((x) => x.energy))),
        h('p', { class: 'line' }, icon('blade'), h('span', { text: c.weapons.map(weaponName).join(' · ') })),
        ...c.skills.map((skill) => h('p', { class: 'line' }, icon(skill.glyph), h('span', {}, h('b', { text: skill.name }), ` ${skill.desc}`))),
        h('p', { class: 'line' }, icon('swap'), h('span', {}, h('b', { text: c.swap.name }), ` ${c.swap.desc}`)),
        owned
          ? button('이 탈로 시작', () => ctx.actions.newGame(id), { class: 'primary', action: `start-${id}` })
          : button([icon('lock'), ...price('soul', c.cost)], () => {
            const result = run(unlockMetaCharacter(game(), id));
            if (result.ok) ctx.actions.metaChanged();
          }, { class: 'buy', disabled: meta.souls < c.cost, action: `unlock-${id}` }));
    });
    return panel('탈 고르기',
      h('p', { class: 'meta', text: '판 중에 다른 탈을 주우면 둘을 번갈아 쓸 수 있다. 바꾸는 순간 교체 기술이 나간다.' }),
      h('div', { class: 'cards scroll' }, cards), souls(), button('돌아가기', () => close(), { action: 'back' }));
  }

  // ── 거점: 영구 강화 ──
  function hub() {
    const meta = state().meta;
    const row = (id) => {
      const u = UPGRADES[id];
      const level = upgradeLevel(meta, id);
      const maxed = level >= u.cost.length;
      const cost = maxed ? null : u.cost[level];
      return h('div', { class: `row upgrade ${u.kind}`, 'data-upgrade': id },
        h('div', { class: 'grow' },
          h('b', {}, u.name, h('span', { class: 'ticks' }, u.cost.map((_, i) => h('i', { class: i < level ? 'on' : '' })))),
          h('small', { text: u.desc })),
        button(maxed ? icon('check') : price('soul', cost), () => {
          const result = run(buyMetaUpgrade(game(), id));
          if (result.ok) ctx.actions.metaChanged();
        }, { disabled: maxed || meta.souls < cost, class: 'buy', action: `buy-${id}` }));
    };
    // 싸우는 방식이 달라지는 강화를 위에, 수치를 더하는 강화를 아래에 묶는다.
    const ids = Object.keys(UPGRADES);
    const rows = [
      h('h4', { class: 'group', text: '싸우는 법이 달라진다' }), ...ids.filter((id) => UPGRADES[id].kind === 'rule').map(row),
      h('h4', { class: 'group', text: '몸이 좋아진다' }), ...ids.filter((id) => UPGRADES[id].kind === 'stat').map(row),
    ];
    // 저주: 한 번 끝까지 깨면 열린다. 단계를 올리면 적이 세지고 영혼석을 더 받는다.
    const curse = meta.curseMax > 0
      ? h('div', { class: 'row curse', 'data-curse': meta.curse },
        h('span', { class: 'tile kind-curse' }, icon('skull')),
        h('div', { class: 'grow' },
          h('b', {}, `저주 ${meta.curse}단계`, h('span', { class: 'ticks' }, Array.from({ length: CURSE.max }, (_, i) => h('i', { class: i < meta.curse ? 'on' : i < meta.curseMax ? '' : 'locked' })))),
          h('small', { text: meta.curse === 0 ? '저주 없이 간다. 올리면 적이 세지고 영혼석을 더 받는다.' : `적 체력 +${Math.round(CURSE.hp * meta.curse * 100)}% · 공격 +${Math.round(CURSE.damage * meta.curse * 100)}% · 영혼석 +${Math.round(CURSE.souls * meta.curse * 100)}%` })),
        button('−', () => { run(setMetaCurse(game(), meta.curse - 1)); ctx.actions.metaChanged(); }, { class: 'toggle', disabled: meta.curse <= 0, action: 'curse-down' }),
        button('+', () => { run(setMetaCurse(game(), meta.curse + 1)); ctx.actions.metaChanged(); }, { class: 'toggle', disabled: meta.curse >= meta.curseMax, action: 'curse-up' }))
      : h('p', { class: 'meta', text: '여섯 층을 모두 뚫으면 저주가 열린다.' });
    const stats = h('p', { class: 'meta', text: `${meta.runs}판 · ${meta.victories}번 탈출 · 한 판에 방 ${meta.bestRooms}개까지 · ${meta.totalKills}마리 처치` });
    const keeper = h('div', { class: 'keeper' }, maskPortrait('shaman'), h('p', {}, h('b', { text: '탈방지기 ' }), keeperLine(meta)));
    // 이야기 다시 보기: 시작, 그리고 한 번 깼으면 끝까지.
    const replay = () => {
      const back = returnTo;
      showStory(meta.victories > 0 ? [...STORY.prologue, ...STORY.ending] : STORY.prologue, () => open('hub', back));
    };
    return panel('탈방', keeper, souls(), curse, h('div', { class: 'list scroll' }, rows), stats,
      h('div', { class: 'pair' },
        button('탈 고르기', () => open('characters', 'hub'), { action: 'characters' }),
        button('이야기', replay, { action: 'story' })),
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
      h('div', { class: 'band' }, icon(familyIcon(b.family, b.duo)), h('small', { text: boonFamily(id) || '무계열' })),
      h('h3', { text: boonName(id) }),
      h('p', { text: b.desc }));
    });
    return panel('축복 하나',
      h('div', { class: 'cards' }, cards),
      h('div', { class: 'pair' },
        button(cost === 0 ? `다시 뽑기 · 공짜 ${state().run.freeRerolls}번` : ['다시 뽑기', ...price('coin', cost)], () => run(rerollBoons(game())), { disabled: state().run.gold < cost, action: 'reroll' }),
        h('div', { class: 'purse' }, icon('coin'), h('span', { class: 'num', text: String(state().run.gold) }))),
      h('p', { class: 'meta', text: '계열 둘을 가지면 합성 축복이 섞여 나온다' }));
  }

  // ── 상점 ──
  function shop() {
    const s = state();
    if (!s.shop) return null;
    const rows = s.shop.stock.map((item, i) => {
      const cost = shopPrice(s, item);
      let name;
      let desc;
      let glyph;
      if (item.kind === 'weapon') {
        name = weaponName(item.weapon);
        desc = `${weaponMeta(item.weapon)} — ${WEAPONS[item.weapon].desc}`;
        glyph = WEAPONS[item.weapon].kind === 'melee' ? 'blade' : 'bolt';
      } else if (item.kind === 'boon') {
        name = boonName(item.boon);
        desc = `${boonFamily(item.boon) || '무계열'} — ${BOONS[item.boon].desc}`;
        glyph = familyIcon(BOONS[item.boon].family, BOONS[item.boon].duo);
      } else {
        name = '붕대';
        desc = '체력을 채운다. 살 때마다 비싸진다.';
        glyph = 'heart';
      }
      return h('div', { class: `row shop-item ${item.sold ? 'sold' : ''}`, 'data-item': i },
        h('span', { class: `tile kind-${item.kind}`, style: item.kind === 'boon' ? `--c:${boonColor(item.boon)}` : null }, icon(glyph)),
        h('div', { class: 'grow' }, h('b', { text: name }), h('small', { text: desc })),
        button(item.sold ? icon('check') : price('coin', cost), () => run(buyShopItem(game(), i)), { disabled: item.sold || s.run.gold < cost, class: 'buy', action: `buy-${i}` }));
    });
    return panel('상점', h('div', { class: 'purse' }, icon('coin'), h('span', { class: 'num', text: String(s.run.gold) })), h('div', { class: 'list scroll' }, rows),
      h('div', { class: 'pair' },
        button(['물건 갈기', ...price('coin', shopRerollCost(s.shop.rerolls))], () => run(rerollShop(game())), { disabled: s.run.gold < shopRerollCost(s.shop.rerolls), action: 'reroll' }),
        button('나가기', () => close(), { class: 'primary', action: 'back' })));
  }

  // ── 일시정지 ──
  function pause() {
    const s = state();
    const boons = s.run.boons.map((id) => h('div', { class: 'row' },
      h('span', { class: 'tile kind-boon', style: `--c:${boonColor(id)}` }, icon(familyIcon(BOONS[id].family, BOONS[id].duo))),
      h('div', { class: 'grow' }, h('b', { text: boonName(id) }), h('small', { text: BOONS[id].desc }))));
    return panel('잠깐 멈춤',
      button('계속', () => close(), { class: 'primary', action: 'resume' }),
      h('div', { class: 'pair' },
        button('설정', () => open('settings', 'pause'), { action: 'settings' }),
        button('저장하고 나가기', () => ctx.actions.toTitle(), { action: 'title' })),
      boons.length ? h('h4', { class: 'group', text: `가진 축복 ${boons.length}` }) : null,
      boons.length ? h('div', { class: 'list scroll' }, boons) : null);
  }

  // ── 설정 ──
  function settings() {
    const values = ctx.getSettings();
    const rows = Object.keys(SETTINGS).map((key) => {
      const rule = SETTINGS[key];
      let control;
      if (rule.type === 'int') {
        const out = h('span', { class: 'value num', text: String(values[key]) });
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
        }, { class: `toggle ${values[key] ? 'on' : ''}`, action: `toggle-${key}` });
      } else {
        control = h('span', { class: 'choices' }, rule.values.map((v) => button(QUALITY_LABELS[v] ?? v, () => {
          ctx.actions.setSetting(key, v);
          render();
        }, { class: `toggle ${values[key] === v ? 'on' : ''}`, action: `${key}-${v}` })));
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
    const tally = (glyph, label, value) => h('div', { class: 'tally' }, icon(glyph), h('span', { text: label }), h('b', { class: 'num', text: String(value) }));
    return h('div', { class: `panel result ${last.victory ? 'win' : 'lose'}` },
      h('h2', { class: 'stamp', text: last.victory ? '탈출!' : '쓰러졌다' }),
      h('div', { class: 'tallies' },
        tally('door', '닿은 곳', `${last.floor}층 ${ZONES[last.floor - 1]?.name ?? ''}`), tally('check', '정리한 방', last.roomsCleared), tally('blade', '처치', last.kills), tally('skull', '정예 · 보스', last.eliteKills + last.bossKills)),
      h('div', { class: 'reward' }, icon('soul'), h('span', { class: 'num', text: `+${last.souls}` })),
      h('p', { class: 'story-line', text: resultLine(last) }),
      last.curseUnlocked ? h('p', { class: 'unlock', text: `저주 ${last.curseUnlocked}단계가 열렸다` }) : null,
      h('p', { class: 'meta', text: `영혼석 ${s.meta.souls}개. 탈방에서 강화를 사거나 새 탈을 푼다.` }),
      button('한 판 더', () => ctx.actions.retry(), { class: 'primary', action: 'retry' }),
      h('div', { class: 'pair' },
        button('탈방', () => ctx.actions.toHub(), { action: 'hub' }),
        button('처음으로', () => ctx.actions.toTitle(), { action: 'title' })));
  }

  /** 탈방지기의 말: 처음 / 아직 못 깸 / 깬 뒤. 판 수로 돌려 가며 고른다. */
  function keeperLine(meta) {
    if (meta.runs === 0) return STORY.keeper.first;
    const lines = meta.victories > 0 ? STORY.keeper.after : STORY.keeper.early;
    return lines[meta.runs % lines.length];
  }

  /** 결과 화면의 한 줄: 쓰러진 곳 또는 저주 단계에 따라. */
  function resultLine(last) {
    if (last.victory) return STORY.victoryLines[Math.min(last.curse ?? 0, STORY.victoryLines.length - 1)];
    const zone = ZONES[last.floor - 1];
    return (zone && STORY.deathLines[zone.id]) || STORY.deathLines.crypt;
  }

  // ── 이야기: 한 쪽에 한 줄, 누르면 다음 쪽 ──
  function storyScreen() {
    if (!story) return null;
    const { pages, index } = story;
    const last = index >= pages.length - 1;
    return h('div', { class: 'story', onclick: (e) => { if (!e.target.closest('button')) nextPage(); } },
      h('div', { class: 'parade' }, CHARACTER_ORDER.map((id) => maskPortrait(id))),
      h('p', { class: 'page', 'data-page': String(index), text: pages[index] }),
      h('p', { class: 'dots' }, pages.map((_, i) => h('i', { class: i === index ? 'on' : '' }))),
      h('div', { class: 'pair' },
        button('건너뛰기', () => endStory(), { action: 'story-skip' }),
        button(last ? '내려간다' : '다음', () => nextPage(), { class: 'primary', action: 'story-next' })));
  }
  function nextPage() {
    if (!story) return;
    if (story.index >= story.pages.length - 1) return endStory();
    story.index += 1;
    ctx.actions.feedback('click');
    render();
    return undefined;
  }
  function endStory() {
    const then = story ? story.then : null;
    story = null;
    if (then) then();
    else close();
  }
  /** 이야기를 띄운다. 다 보거나 건너뛰면 then 을 부른다(없으면 닫는다). */
  function showStory(pages, then = null) {
    if (!Array.isArray(pages) || pages.length === 0) throw new RangeError('showStory: 쪽이 없다');
    story = { pages, index: 0, then };
    open('story', null);
  }

  const BUILDERS = { title, characters, hub, boon, shop, pause, settings, result, story: storyScreen };

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
    story: showStory,
    /** 지금 화면을 다시 그린다(금화가 바뀌었을 때 등). */
    refresh: render,
    get current() {
      return current;
    },
  };
}

export { BOON_RULES };
