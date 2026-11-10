// 패시브 유물. 가지고만 있으면 효과가 난다. 같은 유물은 하나만 가질 수 있다.
//   stats    항상 더해지는 능력치
//   onKill   적을 죽일 때: { heal, gold }
//   onFloor  새 층에 들어갈 때: { healPct }
//   revive   죽을 때 한 번 되살아남: { hpPct } (런마다 한 번)
// unlock 이 있으면 그 메타 해금을 산 뒤에만 나온다.

import { deepFreeze } from './freeze.js';

export const RELICS = deepFreeze({
  whetstone: { name: '숫돌', price: 140, stats: { power: 10 } },
  iron_heart: { name: '강철 심장', price: 140, stats: { maxHp: 25 } },
  lucky_coin: { name: '행운의 동전', price: 110, stats: { goldFind: 30 } },
  hourglass: { name: '모래시계', price: 150, stats: { haste: 8 } },
  owl_charm: { name: '부엉이 부적', price: 110, stats: { xpGain: 15 } },
  ember_core: { name: '불씨 핵', price: 150, stats: { burnChance: 15 } },
  serpent_tooth: { name: '뱀의 이빨', price: 150, stats: { poisonChance: 20 } },
  soul_jar: { name: '영혼 단지', price: 160, onKill: { heal: 2 } },
  midas_ring: { name: '미다스의 반지', price: 130, onKill: { gold: 2 } },
  traveler_boots: { name: '여행자의 장화', price: 150, onFloor: { healPct: 20 } },
  // ── 메타 해금 '유물 꾸러미' ──
  vampire_fang: { name: '흡혈귀의 송곳니', price: 180, unlock: 'relic_pack', stats: { lifesteal: 3 } },
  frost_shard: { name: '서리 조각', price: 150, unlock: 'relic_pack', stats: { slowChance: 15 } },
  assassin_mark: { name: '암살자의 표식', price: 180, unlock: 'relic_pack', stats: { critChance: 8, critDamage: 20 } },
  phoenix_feather: { name: '불사조의 깃털', price: 260, unlock: 'relic_pack', revive: { hpPct: 50 } },
});
