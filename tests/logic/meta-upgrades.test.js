// 거점의 "규칙을 바꾸는" 영구 강화: 첫 선물, 여분의 숨, 불사의 서약, 단골, 응급 처치.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PLAYER } from '../../data/player.js';
import { UPGRADES } from '../../data/meta.js';
import { BOONS } from '../../data/boons.js';
import { shopPrice } from '../../src/logic/commands.js';
import { dealDamage } from '../../src/logic/combat/damage.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { PHASE } from '../../src/logic/core/state.js';
import { createGame, enterFloor } from '../../src/logic/game.js';
import { metaBonuses } from '../../src/logic/items/meta.js';
import { ROOM_KIND } from '../../src/logic/world/floors.js';
import { validateRunState } from '../../src/logic/save/validate.js';
import { createStage } from '../helpers/stage.js';

/** 이 단계들로 산 영구 강화를 가진 메타. */
const metaWith = (upgrades) => ({ version: 2, souls: 0, upgrades, characters: { knight: true } });
const maxed = () => Object.fromEntries(Object.entries(UPGRADES).map(([id, u]) => [id, u.cost.length]));

test('종류 표시: 모든 강화는 rule 이거나 stat 이고, 규칙을 바꾸는 강화가 다섯 가지 있다', () => {
  for (const [id, u] of Object.entries(UPGRADES)) assert.ok(u.kind === 'rule' || u.kind === 'stat', id);
  assert.deepEqual(Object.keys(UPGRADES).filter((id) => UPGRADES[id].kind === 'rule').sort(), ['breath', 'gift', 'haggle', 'mend', 'oath']);
});

test('첫 선물: 새 판의 첫 층에 들어서면 축복 3택1 이 떠 있다(없으면 안 뜬다)', () => {
  const none = createGame({ seed: 'gift-none' });
  enterFloor(none, 1);
  assert.equal(none.state.run.choice, null);

  const game = createGame({ seed: 'gift', meta: metaWith({ gift: 1 }) });
  const offered = [];
  game.bus.on(EVENTS.BOON_OFFERED, (e) => offered.push(e));
  enterFloor(game, 1);
  assert.equal(game.state.run.choice.kind, 'boon');
  assert.equal(game.state.run.choice.options.length, 3);
  assert.equal(offered.length, 1);
  assert.deepEqual(validateRunState(game.state), []);
});

test('첫 선물: 틱이 흐른 판에서 층에 다시 들어가도 다시 뜨지 않는다', () => {
  const game = createGame({ seed: 'gift-again', meta: metaWith({ gift: 1 }) });
  enterFloor(game, 1);
  game.state.run.choice = null;
  game.state.tick = 50;
  enterFloor(game, 1);
  assert.equal(game.state.run.choice, null);
});

test('여분의 숨: 대시를 한 번 더 모아 둔다', () => {
  const a = createGame({ seed: 'breath' });
  const b = createGame({ seed: 'breath', meta: metaWith({ breath: 1 }) });
  enterFloor(a, 1);
  enterFloor(b, 1);
  const pa = a.state.entities.byId[a.state.playerId];
  const pb = b.state.entities.byId[b.state.playerId];
  assert.equal(pa.kit.maxCharges, PLAYER.dash.charges);
  assert.equal(pb.kit.maxCharges, PLAYER.dash.charges + 1);
  assert.equal(pb.kit.charges, pb.kit.maxCharges, '시작할 때 가득 차 있다');
});

test('불사의 서약: 판마다 한 번 되살아나고, 단계마다 체력이 더 찬다', () => {
  for (const level of [1, 2]) {
    const s = createStage({ seed: `oath-${level}`, meta: metaWith({ oath: level }) });
    dealDamage(s.state, s.bus, s.player, 99999, { sourceId: null });
    s.step(1);
    assert.equal(s.player.dead, false);
    assert.equal(s.player.hp, Math.round((s.player.maxHp * UPGRADES.oath.effect.reviveHp * level) / 100));
    assert.equal(s.events(EVENTS.PLAYER_REVIVED).length, 1);
    s.step(200);
    dealDamage(s.state, s.bus, s.player, 99999, { sourceId: null });
    s.step(1);
    assert.equal(s.state.phase, PHASE.GAME_OVER, '두 번째에는 죽는다');
  }
  const none = createStage({ seed: 'oath-none' });
  dealDamage(none.state, none.bus, none.player, 99999, { sourceId: null });
  none.step(1);
  assert.equal(none.state.phase, PHASE.GAME_OVER);
});

test('불사의 서약과 두 번째 바람을 함께 가져도 되살아나는 것은 한 번이고, 체력은 큰 쪽을 따른다', () => {
  const s = createStage({ seed: 'oath-both', meta: metaWith({ oath: 1 }) });
  s.state.run.boons.push('second_wind');
  dealDamage(s.state, s.bus, s.player, 99999, { sourceId: null });
  s.step(1);
  assert.equal(s.player.hp, Math.round((s.player.maxHp * Math.max(BOONS.second_wind.hpPct, UPGRADES.oath.effect.reviveHp)) / 100));
  s.step(200);
  dealDamage(s.state, s.bus, s.player, 99999, { sourceId: null });
  s.step(1);
  assert.equal(s.state.phase, PHASE.GAME_OVER);
});

test('단골: 상점 값이 %로 깎이고, 0 원인 물건은 그대로이며 1 원 밑으로는 내려가지 않는다', () => {
  const need = (map) => map.rooms.some((r) => r.kind === ROOM_KIND.SHOP);
  const base = createStage({ seed: 'haggle', need });
  const cheap = createStage({ seed: 'haggle', need, meta: metaWith({ haggle: 2 }) });
  assert.equal(base.state.shop.stock.length, cheap.state.shop.stock.length);
  const off = UPGRADES.haggle.effect.shopDiscount * 2;
  base.state.shop.stock.forEach((item, i) => {
    const full = shopPrice(base.state, item);
    const got = shopPrice(cheap.state, cheap.state.shop.stock[i]);
    if (full === 0) assert.equal(got, 0);
    else assert.equal(got, Math.max(1, Math.round((full * (100 - off)) / 100)));
  });
  assert.ok(cheap.state.shop.stock.some((item) => shopPrice(cheap.state, item) < shopPrice(base.state, item)));
});

test('응급 처치: 같은 시드·같은 방을 깨면 강화가 있는 쪽이 최대 체력의 %만큼 더 회복해 있다', () => {
  const run = (meta) => {
    const s = createStage({ seed: 'mend', meta });
    s.player.hp = 10;
    s.clear(s.rooms(ROOM_KIND.COMBAT)[0]);
    return s.player;
  };
  const base = run(undefined);
  const mend = run(metaWith({ mend: 2 }));
  const gain = Math.round((base.maxHp * UPGRADES.mend.effect.roomHeal * 2) / 100);
  assert.ok(gain > 0);
  assert.equal(mend.hp - base.hp, Math.min(gain, mend.maxHp - base.hp));
});

test('모든 규칙 강화를 끝까지 올린 메타: 합산 값이 데이터와 같다', () => {
  const total = metaBonuses(metaWith(maxed()));
  assert.equal(total.startBoons, 1);
  assert.equal(total.dashCharges, 1);
  assert.equal(total.reviveHp, 50);
  assert.equal(total.shopDiscount, 30);
  assert.equal(total.roomHeal, 8);
});
