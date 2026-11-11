// HUD: 체력·경험치·층·금화, 보스 체력, 일시정지·가방 버튼, 물약 버튼, 상황 버튼(내려가기·상점·제단), 알림.
// 상태를 읽어 그린다. 프레임마다 update() 를 부르되, 값이 바뀐 것만 DOM 을 고친다.

import { CONSUMABLES } from '../../data/consumables.js';
import { INVENTORY } from '../../data/items.js';
import { PLAYER } from '../../data/player.js';
import { UI } from '../../data/ui.js';
import { ZONES } from '../../data/zones.js';
import { cooldownTicks } from '../logic/combat/abilities.js';
import { canDescend } from '../logic/commands.js';
import { xpToNext } from '../logic/items/levelup.js';
import { h, setText } from './dom.js';

const POTIONS = ['greater_health_potion', 'health_potion'];
const near = (player, place) => {
  const dx = place.x - player.x;
  const dy = place.y - player.y;
  return dx * dx + dy * dy <= INVENTORY.interactRange * INVENTORY.interactRange;
};

/**
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {object} options.on { pause, bag, potion(id), context(kind) } 버튼을 눌렀을 때
 */
export function createHud({ root, on }) {
  const hpFill = h('div', { class: 'fill' });
  const hpText = h('span', { class: 'label' });
  const xpFill = h('div', { class: 'fill' });
  const level = h('span', { class: 'level' });
  const place = h('div', { class: 'place' });
  const gold = h('span', { class: 'gold' });
  const bossFill = h('div', { class: 'fill' });
  const bossName = h('span', { class: 'label' });
  const boss = h('div', { class: 'bar boss hidden' }, bossFill, bossName);
  const potion = h('button', { class: 'btn potion hidden', onclick: () => on.potion(potion.dataset.id) });
  const context = h('button', { class: 'btn context hidden', onclick: () => on.context(context.dataset.kind) });
  const toasts = h('div', { class: 'toasts' });
  const hud = h('div', { class: 'hud hidden' },
    h('div', { class: 'top' },
      h('div', { class: 'vitals' }, h('div', { class: 'bar hp' }, hpFill, hpText), h('div', { class: 'bar xp' }, xpFill), level),
      h('div', { class: 'middle' }, place, boss),
      h('div', { class: 'tools' }, gold, h('button', { class: 'btn small', 'data-hud': 'bag', onclick: () => on.bag() }, '가방'), h('button', { class: 'btn small', 'data-hud': 'pause', onclick: () => on.pause() }, 'Ⅱ'))),
    potion, context);
  root.append(hud, toasts);

  const last = {};
  /** 값이 바뀌었을 때만 fn 을 부른다. */
  const changed = (key, value, fn) => {
    if (last[key] === value) return;
    last[key] = value;
    fn(value);
  };

  return {
    setVisible(visible) {
      hud.classList.toggle('hidden', !visible);
    },
    /** 잠깐 떴다 사라지는 알림. */
    toast(text) {
      const el = h('div', { class: 'toast', text });
      toasts.append(el);
      while (toasts.children.length > 4) toasts.firstChild.remove();
      setTimeout(() => el.remove(), UI.toastMs);
    },
    /**
     * @param {object} game { state, bus } — 상태는 읽기만 한다
     * @returns {Record<string, number>} 버튼 이름 → 남은 재사용 대기 비율(조작부가 그린다)
     */
    update(game) {
      const { state } = game;
      const player = state.playerId !== null ? state.entities.byId[state.playerId] : null;
      const cooling = {};
      if (!player || !state.world) return cooling;

      changed('hp', `${player.hp}/${player.maxHp}`, (text) => {
        setText(hpText, text);
        hpFill.style.width = `${Math.max(0, (100 * player.hp) / player.maxHp)}%`;
      });
      const need = xpToNext(state.run.level);
      changed('xp', Math.round((100 * state.run.xp) / need), (pct) => {
        xpFill.style.width = `${Math.min(100, pct)}%`;
      });
      changed('level', state.run.level, (value) => setText(level, `Lv.${value}`));
      changed('gold', state.inventory.gold, (value) => setText(gold, `${value} G`));
      changed('place', state.run.floor, (floor) => {
        const zone = ZONES.find((z) => z.id === state.world.zoneId);
        setText(place, `${floor}층 · ${zone ? zone.name : ''}`);
      });

      // 보스 체력: 살아 있는 보스가 시야 안에 있을 때.
      let bossActor = null;
      for (const key of Object.keys(state.entities.byId)) {
        const actor = state.entities.byId[key];
        if (actor.kind === 'boss' && !actor.dead) bossActor = actor;
      }
      const seen = bossActor && state.vision.visible[Math.floor(bossActor.y) * state.world.width + Math.floor(bossActor.x)] === 1;
      changed('boss', seen ? `${bossActor.hp}/${bossActor.maxHp}` : '', (text) => {
        boss.classList.toggle('hidden', text === '');
        if (text === '') return;
        bossFill.style.width = `${(100 * bossActor.hp) / bossActor.maxHp}%`;
        setText(bossName, text);
      });

      // 물약 버튼: 가진 체력 물약 가운데 좋은 것부터.
      const potionId = POTIONS.find((id) => state.inventory.consumables[id] > 0) ?? '';
      changed('potion', potionId ? `${potionId}:${state.inventory.consumables[potionId]}` : '', (key) => {
        potion.classList.toggle('hidden', key === '');
        if (key === '') return;
        potion.dataset.id = potionId;
        setText(potion, `${CONSUMABLES[potionId].name} ×${state.inventory.consumables[potionId]}`);
      });

      // 상황 버튼: 계단 위 / 상점 곁 / 제단 곁.
      let kind = '';
      const stairs = canDescend(game);
      if (stairs.ok) kind = 'stairs';
      else if (stairs.reason === 'boss-alive') kind = 'locked';
      else if (state.shop && near(player, state.shop)) kind = 'shop';
      else if (state.altar && !state.altar.used && near(player, state.altar)) kind = 'altar';
      changed('context', kind, (value) => {
        context.classList.toggle('hidden', value === '');
        context.classList.toggle('locked', value === 'locked');
        context.dataset.kind = value;
        setText(context, { stairs: '내려가기', locked: '계단이 잠겨 있다', shop: '상점', altar: '제단', '': '' }[value]);
      });

      // 재사용 대기.
      const ratio = (id, seconds) => {
        const left = (player.cooldowns[id] ?? 0) - state.tick;
        const total = cooldownTicks(player, seconds);
        return left > 0 && total > 0 ? Math.min(1, left / total) : 0;
      };
      PLAYER.skills.forEach((id, i) => {
        cooling[`skill${i}`] = ratio(id, PLAYER.abilities[id].cooldown);
      });
      cooling.dodge = ratio('dodge', PLAYER.dodge.cooldown);
      return cooling;
    },
  };
}
