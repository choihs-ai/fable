// HUD: 체력·에너지, 금화, 무기 두 칸, 가진 축복, 방·웨이브 알림, 보스 체력, 미니맵, 일시정지 버튼, 알림 문구.
// 상태를 읽어 그린다. 프레임마다 update() 를 부르되, 값이 바뀐 것만 DOM 을 고친다.

import { BOSSES } from '../../data/bosses.js';
import { CHARACTERS } from '../../data/characters.js';
import { UI } from '../../data/ui.js';
import { WEAPONS } from '../../data/weapons.js';
import { cooldownTicks } from '../logic/combat/abilities.js';
import { currentRoom } from '../logic/combat/encounter.js';
import { interactTarget } from '../logic/commands.js';
import { h, setText } from './dom.js';
import { createMinimap } from './minimap.js';
import { boonColor, boonName, weaponName } from './text.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {object} options.on { pause, swap } 버튼을 눌렀을 때
 */
export function createHud({ root, on }) {
  const hpFill = h('div', { class: 'fill' });
  const hpText = h('span', { class: 'label' });
  const enFill = h('div', { class: 'fill' });
  const enText = h('span', { class: 'label' });
  const gold = h('span', { class: 'gold' });
  const room = h('div', { class: 'room-info' });
  const bossFill = h('div', { class: 'fill' });
  const bossName = h('span', { class: 'label' });
  const boss = h('div', { class: 'bar boss hidden' }, bossFill, bossName);
  const weaponMain = h('div', { class: 'weapon main' });
  const weaponOff = h('div', { class: 'weapon off', 'data-tap': '', onclick: () => on.swap() });
  const boons = h('div', { class: 'boons' });
  const banner = h('div', { class: 'banner hidden' });
  const toasts = h('div', { class: 'toasts' });
  const side = h('div', { class: 'side' });
  const hud = h('div', { class: 'hud hidden' },
    h('div', { class: 'top' },
      h('div', { class: 'vitals' },
        h('div', { class: 'bar hp' }, hpFill, hpText),
        h('div', { class: 'bar energy' }, enFill, enText),
        h('div', { class: 'weapons' }, weaponMain, weaponOff),
        boons),
      h('div', { class: 'middle' }, room, boss),
      h('div', { class: 'tools' }, gold, h('button', { class: 'btn small', 'data-hud': 'pause', onclick: () => on.pause() }, 'Ⅱ'), side)),
    banner);
  root.append(hud, toasts);
  const minimap = createMinimap(side);

  const last = {};
  /** 값이 바뀌었을 때만 fn 을 부른다. */
  const changed = (key, value, fn) => {
    if (last[key] === value) return;
    last[key] = value;
    fn(value);
  };
  let bannerTimer = null;

  return {
    setVisible(visible) {
      hud.classList.toggle('hidden', !visible);
      if (!visible) minimap.reset();
    },
    /** 잠깐 떴다 사라지는 알림. */
    toast(text) {
      const el = h('div', { class: 'toast', text });
      toasts.append(el);
      while (toasts.children.length > 3) toasts.firstChild.remove();
      setTimeout(() => el.remove(), UI.toastMs);
    },
    /** 화면 가운데의 큰 글자(방 깨기, 웨이브). */
    banner(text, kind = '') {
      banner.textContent = text;
      banner.className = `banner ${kind}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.add('hidden'), 1300);
    },
    /**
     * 상태를 그린다. @returns {object} 조작부에 넘길 표시(재사용 대기, 대시 충전, 상호작용 글자)
     */
    update(game) {
      const { state } = game;
      const player = state.entities.byId[state.playerId];
      if (!player || !state.world) return { cooling: {}, charges: 0, maxCharges: 0, interact: null, swap: false };
      const kit = player.kit;
      changed('hp', `${player.hp}/${player.maxHp}`, (v) => {
        hpFill.style.width = `${(100 * player.hp) / player.maxHp}%`;
        setText(hpText, v);
        hud.classList.toggle('low-hp', player.hp <= player.maxHp * 0.3);
      });
      changed('en', `${Math.floor(kit.energy)}/${kit.maxEnergy}`, (v) => {
        enFill.style.width = `${(100 * kit.energy) / kit.maxEnergy}%`;
        setText(enText, v);
      });
      changed('gold', state.run.gold, (v) => setText(gold, `${v}`));
      changed('weapons', `${kit.weapons.join(',')}|${kit.slot}|${kit.dualUntil > state.tick}`, () => {
        const main = kit.weapons[kit.slot];
        const off = kit.weapons[1 - kit.slot];
        weaponMain.replaceChildren(h('b', { text: weaponName(main) }), h('small', { text: main ? (WEAPONS[main].kind === 'melee' ? '근접' : `⚡${WEAPONS[main].energy}`) : '' }));
        weaponOff.replaceChildren(h('b', { text: off ? weaponName(off) : '—' }), h('small', { text: off ? '눌러서 교체' : '' }));
        weaponOff.classList.toggle('empty', !off);
        hud.classList.toggle('dual', kit.dualUntil > state.tick);
      });
      changed('boons', state.run.boons.join(','), () => {
        boons.replaceChildren(...state.run.boons.map((id) => h('span', { class: 'boon-chip', style: `--c:${boonColor(id)}`, text: boonName(id) })));
      });

      // 방과 웨이브.
      const here = currentRoom(state);
      const enc = state.encounter;
      let info = '';
      if (enc) {
        const r = state.world.rooms[enc.room];
        const alive = Object.values(state.entities.byId).filter((a) => a.faction === 'enemy' && !a.dead).length + enc.pending.length;
        info = r.kind === 'boss' ? '보스' : `웨이브 ${r.wave + 1}/${r.waves.length} · 남은 적 ${alive}`;
      } else if (here) {
        info = { start: '시작 방', shop: '상점', reward: '보상 방', exit: '출구', bonus: '숨은 방' }[here.kind] ?? (here.state === 'cleared' ? '깬 방' : '');
      }
      changed('room', info, (v) => setText(room, v));

      // 보스 체력.
      const bossActor = Object.values(state.entities.byId).find((a) => a.kind === 'boss' && !a.dead) ?? null;
      changed('boss', bossActor ? `${bossActor.type}:${bossActor.hp}/${bossActor.maxHp}:${bossActor.ai.phase}` : '', () => {
        boss.classList.toggle('hidden', !bossActor);
        if (bossActor) {
          bossFill.style.width = `${(100 * bossActor.hp) / bossActor.maxHp}%`;
          setText(bossName, BOSSES[bossActor.type].name);
        }
      });
      minimap.update(state, here ? here.id : null);

      // 조작부 표시.
      const skill = CHARACTERS[kit.character].skill;
      const skillLeft = Math.max(0, (player.cooldowns.skill ?? 0) - state.tick);
      const skillTotal = cooldownTicks(player, skill.cooldown);
      const target = interactTarget(state);
      let interact = null;
      if (target) interact = target.type === 'weapon' ? weaponName(target.weapon) : target.type === 'shop' ? '상점' : '포털';
      const recharge = kit.chargeAt > 0 ? Math.max(0, kit.chargeAt - state.tick) / kit.rechargeTicks : 0;
      return {
        cooling: { skill: skillTotal > 0 ? skillLeft / skillTotal : 0, dash: kit.charges === 0 ? recharge : 0 },
        charges: kit.charges,
        maxCharges: kit.maxCharges,
        interact,
        swap: kit.weapons[1 - kit.slot] !== null,
        skill: skill.name,
      };
    },
  };
}
