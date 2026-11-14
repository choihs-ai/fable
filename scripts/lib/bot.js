// 맛보기 판을 스스로 플레이하는 봇. 로직(src/logic)만 쓰므로 Node 와 브라우저에서 똑같이 돈다.
//
// 봇이 하는 일: 방을 골라 들어가고, 거리를 재며 싸우고(탄·예고된 공격은 대시나 걸음으로 피한다),
// 떨어진 것을 줍고, 축복을 고르고, 상점에서 사고, 보스를 잡고, 출구 포털로 나간다.
// 목적은 잘하는 것이 아니라 "사람이 할 법한 조작으로 한 판이 처음부터 끝까지 굴러가는지" 보는 것이다.
// 난수를 쓰지 않으므로 같은 시드의 판은 언제 돌려도 같은 결과가 나온다.

import { CHARACTERS } from '../../data/characters.js';
import { WEAPONS, WEAPON_UPGRADE } from '../../data/weapons.js';
import { buyShopItem, chooseBoon, interact, interactTarget, shopPrice, swapWeapons } from '../../src/logic/commands.js';
import { isReady } from '../../src/logic/combat/abilities.js';
import { createNavMemory, steerAway, steerToward } from '../../src/logic/combat/ai/steer.js';
import { currentRoom } from '../../src/logic/combat/encounter.js';
import { setInput, skillKey } from '../../src/logic/combat/player.js';
import { PHASE } from '../../src/logic/core/state.js';
import { getPlayer, opponentsOf } from '../../src/logic/entities/actors.js';
import { defOf } from '../../src/logic/entities/defs.js';
import { circleFree } from '../../src/logic/world/collide.js';
import { ROOM_KIND, isFightRoom } from '../../src/logic/world/floors.js';
import { lineOfSight } from '../../src/logic/world/los.js';
import { navOf } from '../../src/logic/world/nav.js';

/** 축복을 고르는 순서(앞에 있을수록 먼저 고른다). 목록에 없는 것은 맨 뒤. */
const BOON_PRIORITY = [
  'chain', 'pierce', 'blast_kill', 'ignite', 'split', 'afterimage', 'frost_shot', 'third_dash', 'vampire', 'second_wind',
  'superconduct', 'plasma', 'steam', 'shatter', 'overcharge', 'momentum', 'giant_slayer', 'conduct', 'static_dash',
];

/**
 * @param {object} [options]
 * @param {'full'|'short'} [options.plan] full: 갈 수 있는 방을 모두 깬 뒤 보스로. short: 보스로 가는 가장 짧은 길만.
 * @param {boolean} [options.dodge] false 면 피하지 않는다(난이도 확인용)
 * @param {number} [options.dodgeRate] 위협(탄·예고된 공격) 가운데 알아채는 비율(%). 기본 100. 사람처럼 놓치는 봇을 만들 때 낮춘다
 */
export function createBot(options = {}) {
  return {
    plan: options.plan ?? 'full',
    dodgeRate: options.dodge === false ? 0 : options.dodgeRate ?? 100,
    nav: createNavMemory(),
    strafeSign: 1,
    strafeFlipAt: 0,
    /** 줍지 않기로 한 무기(전리품 id). */
    ignored: [],
    /** 주우러 가는 전리품의 id 와 그것을 정한 틱. */
    dropId: null,
    dropSince: 0,
    /** 가고 있는 방. */
    target: null,
    shopDone: false,
    /** 제자리걸음 감지. */
    lastX: 0,
    lastY: 0,
    lastMoveTick: 0,
    stuck: 0,
  };
}

const dist2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/** 공격 하나가 닿는 거리(근접 무기의 사정거리). */
function reachOf(weapon) {
  let reach = 0;
  for (const e of weapon.attack.effects) {
    if (e.type === 'arc') reach = Math.max(reach, e.range);
    if (e.type === 'circle') reach = Math.max(reach, e.radius);
  }
  return reach;
}

/** 피해야 할 것이 있으면 피할 방향을 돌려준다. urgent 면 대시로 피한다. */
function findThreat(state, nav, player, rate) {
  const tick = state.tick;
  let best = null;
  const consider = (x, y, urgent, weight) => {
    if (!best || weight > best.weight) best = { x, y, urgent, weight };
  };
  // 위협마다 정해진 번호로 "알아챘는가"를 정한다(난수를 쓰지 않고, 같은 위협은 끝까지 같은 판정).
  const noticed = (n) => (Math.imul(n, 2654435761) >>> 0) % 100 < rate;
  // 날아오는 탄: 곧 닿을 것만 본다. 탄의 진행 방향에 수직으로 피한다.
  for (const p of state.projectiles) {
    if (p.faction === player.faction || !noticed(p.id)) continue;
    const speed2 = p.vx * p.vx + p.vy * p.vy;
    if (speed2 < 1e-6) continue;
    const rx = player.x - p.x;
    const ry = player.y - p.y;
    const t = (rx * p.vx + ry * p.vy) / speed2;
    if (t < 0 || t > 0.4) continue;
    const cx = rx - p.vx * t;
    const cy = ry - p.vy * t;
    const reach = player.radius + p.radius + 0.25;
    if (cx * cx + cy * cy > reach * reach) continue;
    const speed = Math.sqrt(speed2);
    let nx = -p.vy / speed;
    let ny = p.vx / speed;
    // 이미 비켜 서 있는 쪽으로 더 비킨다.
    if (nx * cx + ny * cy < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (!circleFree(nav, player.x + nx * 1.2, player.y + ny * 1.2, player.radius)) {
      nx = -nx;
      ny = -ny;
    }
    consider(nx, ny, t < 0.22, 3 - t);
  }
  // 준비 중인 공격: 범위 안에 있으면 벗어난다.
  for (const enemy of opponentsOf(state, player.faction)) {
    const action = enemy.action;
    if (!action || action.phase !== 'windup' || !noticed(enemy.id + action.until)) continue;
    const left = action.until - tick;
    const ability = defOf(enemy).abilities[action.ability];
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ux = d > 1e-6 ? dx / d : 1;
    const uy = d > 1e-6 ? dy / d : 0;
    for (const e of ability.effects) {
      let hit = false;
      if (e.type === 'arc') hit = d <= e.range + player.radius + 0.5 && ux * action.dirX + uy * action.dirY >= e.cosHalf - 0.25;
      else if (e.type === 'circle') hit = d <= e.radius + player.radius + 0.5;
      else if (e.type === 'dash') {
        // 돌진: 진행 선 가까이에 있으면 옆으로 비킨다.
        const along = dx * action.dirX + dy * action.dirY;
        const side = dx * action.dirY - dy * action.dirX;
        if (along > 0 && along < e.distance + 1 && Math.abs(side) < player.radius + enemy.radius + 0.5) {
          const s = side >= 0 ? 1 : -1;
          consider(action.dirY * s, -action.dirX * s, left <= 10, 2.5);
        }
      }
      if (hit) consider(ux, uy, left <= 12, 2);
    }
  }
  // 곧 터질 장판.
  for (const hz of state.hazards) {
    if (hz.faction === player.faction || hz.kind !== 'blast' || !noticed(hz.id)) continue;
    const dx = player.x - hz.x;
    const dy = player.y - hz.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > hz.radius + player.radius + 0.3) continue;
    const left = hz.nextAt - tick;
    if (left > 45) continue;
    consider(d > 1e-6 ? dx / d : 1, d > 1e-6 ? dy / d : 0, left <= 14, 2.2);
  }
  return best;
}

/** 방 그래프에서 from 부터의 걸음 수와 거쳐 온 방(열려 있는 길로만). */
function roomHops(map, from) {
  const hops = new Array(map.rooms.length).fill(-1);
  const parent = new Array(map.rooms.length).fill(-1);
  hops[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const a = queue[head];
    for (const id of map.rooms[a].doors) {
      const door = map.doors[id];
      if (!door.open || hops[door.to] !== -1) continue;
      // 문이 닫힌 숨은 굴은 건너지 않는다.
      const link = map.links[door.link];
      if (link.doors.some((d) => !map.doors[d].open)) continue;
      hops[door.to] = hops[a] + 1;
      parent[door.to] = a;
      queue.push(door.to);
    }
  }
  return { hops, parent };
}

/** 다음에 갈 방을 고른다: 목적지를 정하고, 거기로 가는 길의 바로 옆 방을 돌려준다(먼 길은 한 방씩 건너간다). 갈 곳이 없으면 null. */
function pickRoom(state, bot, room) {
  const map = state.world;
  const { hops, parent } = roomHops(map, room.id);
  const reachable = map.rooms.filter((r) => hops[r.id] > 0);
  const nearest = (list) => list.slice().sort((a, b) => hops[a.id] - hops[b.id] || a.id - b.id)[0] ?? null;
  const boss = map.rooms.find((r) => r.kind === ROOM_KIND.BOSS);
  let goal = null;
  if (boss.state === 'cleared') goal = nearest(reachable.filter((r) => r.kind === ROOM_KIND.EXIT));
  else {
    if (bot.plan === 'full') {
      const todo = reachable.filter((r) => r.state === 'idle' && r.kind !== ROOM_KIND.BOSS && (isFightRoom(r.kind) || r.kind === ROOM_KIND.REWARD));
      if (todo.length > 0) goal = nearest(todo);
      else if (!bot.shopDone && state.run.gold >= 30) goal = reachable.find((r) => r.kind === ROOM_KIND.SHOP) ?? null;
    }
    if (!goal && hops[boss.id] > 0) goal = boss;
  }
  if (!goal) return null;
  let step = goal.id;
  while (parent[step] !== room.id) step = parent[step];
  return map.rooms[step];
}

/**
 * 무기 하나를 얻으면 바뀌는 칸(등급이 낮은 쪽)을 빼고, 그래도 근접 무기가 남는가.
 * 에너지는 저절로 차지 않으므로 원거리 둘만 들면 여섯 층을 가는 동안 개머리판만 휘두르게 된다.
 */
function keepsMelee(kit, weaponId) {
  if (WEAPONS[weaponId].kind === 'melee' || kit.weapons.includes(null)) return true;
  const hadMelee = kit.weapons.some((id) => WEAPONS[id].kind === 'melee');
  if (!hadMelee) return true;
  const current = kit.weapons[kit.slot];
  const other = kit.weapons[1 - kit.slot];
  const replaced = WEAPONS[other].tier < WEAPONS[current].tier ? other : current;
  const kept = replaced === other ? current : other;
  return WEAPONS[kept].kind === 'melee';
}

/** 상점에서 살 만한 것을 산다. */
function shopping(game, player) {
  const { state } = game;
  const held = player.kit.weapons.filter(Boolean).map((id) => WEAPONS[id].tier);
  const minTier = Math.min(...held);
  state.shop.stock.forEach((item, index) => {
    if (item.sold || state.run.gold < shopPrice(state, item)) return;
    if (item.kind === 'heal' && player.hp < player.maxHp * 0.65) buyShopItem(game, index);
    else if (item.kind === 'boon') buyShopItem(game, index);
    else if (item.kind === 'weapon' && WEAPONS[item.weapon].tier > minTier && keepsMelee(player.kit, item.weapon)) {
      // 등급이 낮은 쪽을 들고 사면 그 무기와 바뀐다.
      const kit = player.kit;
      const other = kit.weapons[1 - kit.slot];
      if (other && WEAPONS[other].tier < WEAPONS[kit.weapons[kit.slot]].tier) swapWeapons(game);
      buyShopItem(game, index);
    }
  });
}

/** 전투 중의 조작. */
function fight(game, bot, nav, player, input) {
  const { state } = game;
  const kit = player.kit;
  const tick = state.tick;
  const enemies = opponentsOf(state, player.faction);

  // 무기 고르기: 에너지가 넉넉하면 원거리, 모자라면 근접.
  const current = WEAPONS[kit.weapons[kit.slot]];
  const otherId = kit.weapons[1 - kit.slot];
  const other = otherId ? WEAPONS[otherId] : null;
  if (other) {
    const lowEnergy = kit.energy < Math.max(current.energy, other.energy) * 3;
    if (current.kind === 'ranged' && other.kind === 'melee' && lowEnergy) swapWeapons(game);
    else if (current.kind === 'melee' && other.kind === 'ranged' && kit.energy >= kit.maxEnergy * 0.4) swapWeapons(game);
  }
  const weapon = WEAPONS[kit.weapons[kit.slot]];

  let nearest = null;
  let nearestD2 = Infinity;
  for (const enemy of enemies) {
    const d2 = dist2(enemy, player);
    if (d2 < nearestD2) {
      nearest = enemy;
      nearestD2 = d2;
    }
  }

  const threat = bot.dodgeRate > 0 ? findThreat(state, nav, player, bot.dodgeRate) : null;
  if (threat) {
    input.moveX = threat.x;
    input.moveY = threat.y;
    if (threat.urgent && kit.charges > 0 && !player.dash) input.dash = true;
  } else if (nearest) {
    const d = Math.sqrt(nearestD2);
    const los = lineOfSight(nav, player.x, player.y, nearest.x, nearest.y);
    // 에너지가 없으면 원거리 무기도 개머리판으로 치는 근접 무기다.
    const empty = weapon.energy > 0 && kit.energy < weapon.energy;
    if (weapon.kind === 'melee' || empty) {
      const reach = (empty ? 1.4 : reachOf(weapon)) + nearest.radius;
      if (d > reach * 0.8 || !los) {
        const s = steerToward(nav, player, bot.nav, nearest.x, nearest.y, tick);
        input.moveX = s.x;
        input.moveY = s.y;
      }
    } else if (d < 3.4) {
      const s = steerAway(nav, player, nearest.x, nearest.y);
      input.moveX = s.x;
      input.moveY = s.y;
      if (!s.ok) {
        // 구석에 몰렸다: 대시로 빠져나간다.
        input.moveX = (nearest.y - player.y) / Math.max(d, 1e-6);
        input.moveY = -(nearest.x - player.x) / Math.max(d, 1e-6);
        if (kit.charges > 0 && d < 1.6) input.dash = true;
      }
    } else if (d > 6.5 || !los) {
      const s = steerToward(nav, player, bot.nav, nearest.x, nearest.y, tick);
      input.moveX = s.x;
      input.moveY = s.y;
    } else {
      // 거리가 맞으면 옆으로 걷는다. 막히면 방향을 바꾼다.
      if (tick >= bot.strafeFlipAt) {
        bot.strafeSign = -bot.strafeSign;
        bot.strafeFlipAt = tick + 80;
      }
      let sx = (-(nearest.y - player.y) / d) * bot.strafeSign;
      let sy = ((nearest.x - player.x) / d) * bot.strafeSign;
      if (!circleFree(nav, player.x + sx * 0.7, player.y + sy * 0.7, player.radius)) {
        bot.strafeSign = -bot.strafeSign;
        sx = -sx;
        sy = -sy;
      }
      input.moveX = sx;
      input.moveY = sy;
    }
  }
  input.attack = nearest !== null;
  // 스킬 둘: 적이 둘 이상이거나 보스일 때 준비된 것부터 쓴다(회복 스킬은 체력이 깎였을 때만).
  if (nearest && (enemies.length >= 2 || nearest.kind === 'boss')) {
    const skills = CHARACTERS[kit.character].skills;
    for (let i = 0; i < skills.length; i++) {
      if (!isReady(state, player, skillKey(kit.character, i))) continue;
      if (skills[i].type === 'heal' && player.hp > player.maxHp * 0.7) continue;
      if (i === 0) input.skill = true;
      else input.skill2 = true;
      break;
    }
  }
}

/** 싸우지 않을 때: 줍고, 사고, 다음 방으로 간다. */
function explore(game, bot, nav, player, input) {
  const { state } = game;
  const tick = state.tick;
  const kit = player.kit;
  const goTo = (x, y) => {
    const s = steerToward(nav, player, bot.nav, x, y, tick);
    input.moveX = s.x;
    input.moveY = s.y;
    return s.reachable;
  };

  // 가까이 떨어져 있는 것부터 줍는다. 한번 정하면 주울 때까지 그것만 본다(엄폐물에 가려졌다 보였다 하며 오락가락하지 않도록).
  // 너무 오래 걸리면 포기한다.
  let want = bot.dropId === null ? null : state.drops.find((d) => d.id === bot.dropId) ?? null;
  if (want && tick - bot.dropSince > 480) {
    bot.ignored.push(want.id);
    want = null;
  }
  if (!want) {
    bot.dropId = null;
    let wantD2 = 12 * 12;
    for (const drop of state.drops) {
      if (bot.ignored.includes(drop.id)) continue;
      if (drop.kind === 'weapon') {
        const tiers = kit.weapons.filter(Boolean).map((id) => WEAPONS[id].tier);
        const held = kit.weapons.indexOf(drop.weapon);
        // 든 무기면 강화(최고 단계가 아닐 때), 아니면 빈 칸이 있거나 더 좋은 무기일 때.
        const wanted = held !== -1
          ? kit.levels[held] < WEAPON_UPGRADE.max
          : kit.weapons.includes(null) || (WEAPONS[drop.weapon].tier > Math.min(...tiers) && keepsMelee(kit, drop.weapon));
        if (!wanted) {
          bot.ignored.push(drop.id);
          continue;
        }
      } else if (drop.kind === 'form') {
        // 탈: 빈 칸이 있을 때만 줍는다(둘을 들면 더 바꾸지 않는다).
        if (!kit.forms.includes(null) || kit.forms.includes(drop.form)) {
          bot.ignored.push(drop.id);
          continue;
        }
      } else if (drop.kind === 'health' && player.hp >= player.maxHp) continue;
      else if (drop.kind === 'energy' && kit.energy >= kit.maxEnergy) continue;
      const d2 = dist2(drop, player);
      if (d2 < wantD2 && lineOfSight(nav, player.x, player.y, drop.x, drop.y)) {
        want = drop;
        wantD2 = d2;
      }
    }
    if (want) {
      bot.dropId = want.id;
      bot.dropSince = tick;
    }
  }
  if (want) {
    const target = interactTarget(state);
    if (want.kind === 'weapon' && target && target.type === 'weapon' && target.dropId === want.id) {
      // 등급이 낮은 쪽을 들고 주우면 그 무기와 바뀐다.
      const other = kit.weapons[1 - kit.slot];
      const upgrade = kit.weapons.includes(want.weapon);
      if (!upgrade && !kit.weapons.includes(null) && other && WEAPONS[other].tier < WEAPONS[kit.weapons[kit.slot]].tier) swapWeapons(game);
      interact(game);
      return;
    }
    if (want.kind === 'form' && target && target.type === 'form' && target.dropId === want.id) {
      interact(game);
      return;
    }
    goTo(want.x, want.y);
    return;
  }

  const room = currentRoom(state);
  if (room && room.kind === ROOM_KIND.SHOP && !bot.shopDone) {
    const target = interactTarget(state);
    if (target && target.type === 'shop') {
      shopping(game, player);
      bot.shopDone = true;
    } else {
      goTo(room.feature.x + 0.5, room.feature.y + 0.5);
    }
    return;
  }
  if (room && room.kind === ROOM_KIND.EXIT) {
    const target = interactTarget(state);
    if (target && target.type === 'portal') interact(game);
    else goTo(room.feature.x + 0.5, room.feature.y + 0.5);
    return;
  }

  // 아직 싸우지 않은 방의 문턱에 서 있으면 안으로 들어간다.
  if (room && room.state === 'idle' && isFightRoom(room.kind)) {
    goTo(room.feature.x + 0.5, room.feature.y + 0.5);
    return;
  }
  // 다음 방. 복도에 서 있을 때는 가던 방으로 계속 간다.
  if (room) {
    const next = pickRoom(state, bot, room);
    bot.target = next ? next.id : null;
  }
  if (bot.target !== null) {
    const next = state.world.rooms[bot.target];
    goTo(next.feature.x + 0.5, next.feature.y + 0.5);
  }
}

/**
 * 한 틱의 조작을 정해 로직에 넣는다(명령도 여기서 내린다). tick() 직전에 부른다.
 * @returns {object} 이번 틱에 넣은 입력
 */
export function botStep(game, bot) {
  const { state } = game;
  const input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false, skill2: false };
  if (state.phase !== PHASE.PLAYING || !state.world) return input;
  const player = getPlayer(state);
  if (!player || player.dead) return input;

  // 축복 3택1: 우선순위가 높은 것을 고른다.
  if (state.run.choice) {
    const { options } = state.run.choice;
    let best = 0;
    let bestRank = Infinity;
    options.forEach((id, i) => {
      const rank = BOON_PRIORITY.includes(id) ? BOON_PRIORITY.indexOf(id) : BOON_PRIORITY.length + i;
      if (rank < bestRank) {
        best = i;
        bestRank = rank;
      }
    });
    chooseBoon(game, best);
  }

  const nav = navOf(state.world);
  if (state.encounter) fight(game, bot, nav, player, input);
  else explore(game, bot, nav, player, input);

  // 제자리걸음: 한동안 움직이지 못했으면 길찾기를 처음부터 다시 한다.
  if ((player.x - bot.lastX) * (player.x - bot.lastX) + (player.y - bot.lastY) * (player.y - bot.lastY) > 0.25) {
    bot.lastX = player.x;
    bot.lastY = player.y;
    bot.lastMoveTick = state.tick;
  } else if (state.tick - bot.lastMoveTick > 300 && !state.encounter) {
    bot.stuck += 1;
    bot.lastMoveTick = state.tick;
    bot.nav = createNavMemory();
  }

  setInput(state, input);
  return input;
}
