// 화면에 보일 문구를 데이터에서 만든다(이름, 능력치 줄, 효과 설명).

import { CONSUMABLES } from '../../data/consumables.js';
import { BASES, RARITY, SETS, SLOT_NAMES, STATS } from '../../data/items.js';
import { UNLOCKS } from '../../data/meta.js';
import { RELICS } from '../../data/relics.js';
import { STATUSES } from '../../data/statuses.js';
import { FILLERS, UPGRADES } from '../../data/upgrades.js';

/** "공격력 +10%" */
export function statText(stat, value) {
  const info = STATS[stat];
  return `${info ? info.name : stat} ${value > 0 ? '+' : ''}${value}${info ? info.unit : ''}`;
}

export function statsText(stats) {
  return Object.keys(stats).map((key) => statText(key, stats[key])).join(', ');
}

export function itemName(item) {
  const set = item.setId ? `${SETS[item.setId].name}의 ` : '';
  return `${set}${BASES[item.base].name}`;
}

export function itemMeta(item) {
  return `${RARITY[item.rarity].name} · ${SLOT_NAMES[item.slot]} · Lv.${item.ilvl}`;
}

/** 장비의 옵션 줄(고유 옵션 먼저). 세트 장비면 세트 효과도 덧붙인다. */
export function itemLines(item) {
  const lines = [...item.implicit, ...item.affixes].map((o) => statText(o.stat, o.value));
  if (item.setId) {
    const set = SETS[item.setId];
    for (const count of Object.keys(set.bonus)) lines.push(`[${set.name} ${count}세트] ${statsText(set.bonus[count])}`);
  }
  return lines;
}

function statusName(id) {
  return STATUSES[id] ? STATUSES[id].name : id;
}

export function consumableText(id) {
  const def = CONSUMABLES[id];
  const e = def.effect;
  let desc = '';
  if (e.type === 'heal') desc = `최대 체력의 ${e.pct}% 회복`;
  else if (e.type === 'cleanse') desc = '상태이상을 모두 지운다';
  else if (e.type === 'buff') desc = `${e.seconds}초 동안 ${statsText(e.stats)}`;
  else if (e.type === 'blast') desc = `주변 ${e.radius}칸에 피해 ${e.damage}${e.status ? `, ${statusName(e.status.id)}` : ''}`;
  return { name: def.name, desc };
}

export function relicText(id) {
  const def = RELICS[id];
  const parts = [];
  if (def.stats) parts.push(statsText(def.stats));
  if (def.onKill) parts.push(`처치할 때마다 ${def.onKill.heal ? `체력 ${def.onKill.heal} 회복` : `금화 ${def.onKill.gold}`}`);
  if (def.onFloor) parts.push(`층을 내려갈 때 체력 ${def.onFloor.healPct}% 회복`);
  if (def.revive) parts.push(`한 번 죽음을 피하고 체력 ${def.revive.hpPct}% 로 되살아난다`);
  return { name: def.name, desc: parts.join(', ') };
}

/** 강화 3택1 의 후보. owned 는 지금 가진 단계. */
export function choiceText(option, owned) {
  if (option.kind === 'upgrade') {
    const def = UPGRADES[option.id];
    const rank = owned[option.id] ?? 0;
    return { name: def.name, desc: statsText(def.stats), note: `${rank} → ${rank + 1} / ${def.maxRank}단계` };
  }
  const def = FILLERS[option.id];
  const e = def.effect;
  const desc = e.type === 'heal' ? `최대 체력의 ${e.pct}% 회복` : e.type === 'gold' ? `금화 ${e.base} + 레벨당 ${e.perLevel}` : statsText(e.stats);
  return { name: def.name, desc, note: '보상' };
}

export function altarCostText(cost) {
  if (cost.type === 'hpPct') return `지금 체력의 ${cost.pct}%`;
  if (cost.type === 'gold') return `금화 ${cost.amount}`;
  if (cost.type === 'maxHp') return `최대 체력 -${cost.amount} (영구)`;
  return `저주: ${statsText(cost.stats)} (영구)`;
}

export function altarRewardText(reward) {
  if (reward.type === 'stats') return statsText(reward.stats);
  if (reward.type === 'gold') return `금화 ${reward.amount}`;
  if (reward.type === 'heal') return '체력을 모두 회복';
  if (reward.type === 'upgrade') return '강화 하나 선택';
  return '유물 하나';
}

export function unlockText(id) {
  const def = UNLOCKS[id];
  const e = def.effect;
  const parts = [];
  if (e.stats) parts.push(statsText(e.stats));
  if (e.gold) parts.push(`시작 금화 +${e.gold}`);
  if (e.capacity) parts.push(`가방 +${e.capacity}칸`);
  if (e.consumables) parts.push(Object.keys(e.consumables).map((key) => `${CONSUMABLES[key].name} ${e.consumables[key]}개로 시작`).join(', '));
  if (e.pool) parts.push('새 아이템이 나오기 시작한다');
  return { name: def.name, desc: parts.join(', '), cost: def.cost, requires: def.requires ? UNLOCKS[def.requires].name : null };
}

/** 명령이 거절된 이유를 사람 말로. */
const REASONS = {
  'no-gold': '금화가 모자랍니다',
  'bag-full': '가방이 가득 찼습니다',
  'stack-full': '더 가질 수 없습니다',
  'already-owned': '이미 가진 유물입니다',
  'sold-out': '이미 팔렸습니다',
  'too-far': '너무 멉니다',
  'full-hp': '체력이 가득합니다',
  'nothing-to-cleanse': '지울 상태이상이 없습니다',
  'none-left': '남은 것이 없습니다',
  'too-weak': '감당할 수 없습니다',
  'boss-alive': '보스를 쓰러뜨려야 계단이 열립니다',
  'no-souls': '영혼석이 모자랍니다',
  locked: '앞 단계를 먼저 해금해야 합니다',
  used: '이미 제단을 썼습니다',
};
export function reasonText(reason) {
  return REASONS[reason] ?? `할 수 없습니다 (${reason})`;
}
