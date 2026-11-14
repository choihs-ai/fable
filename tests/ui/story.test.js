// 이야기 문구(data/story.js)가 게임의 구역·보스·탈을 빠짐없이 덮는지.

import assert from 'node:assert/strict';
import test from 'node:test';
import { BOSSES } from '../../data/bosses.js';
import { CHARACTER_ORDER } from '../../data/characters.js';
import { CURSE } from '../../data/meta.js';
import { STORY } from '../../data/story.js';
import { WORLD } from '../../data/world.js';
import { ZONES } from '../../data/zones.js';

const filled = (text) => typeof text === 'string' && text.trim().length > 0;

test('이야기: 층마다 장 제목·한 줄·쓰러졌을 때의 한 줄이 있다', () => {
  for (let floor = 1; floor <= WORLD.stages; floor++) {
    const zone = ZONES[floor - 1];
    assert.ok(zone, `${floor}층의 구역`);
    const chapter = STORY.chapters[zone.id];
    assert.ok(chapter && filled(chapter.title) && filled(chapter.line), `${zone.id} 장`);
    assert.ok(chapter.title.startsWith(`${floor}장`), `${zone.id} 의 장 번호가 층과 같다`);
    assert.ok(filled(STORY.deathLines[zone.id]), `${zone.id} 쓰러짐`);
  }
});

test('이야기: 층마다의 보스가 등장·쓰러질 때 한 마디씩 한다', () => {
  for (let floor = 1; floor <= WORLD.stages; floor++) {
    const boss = ZONES[floor - 1].boss;
    assert.ok(boss && Object.hasOwn(BOSSES, boss.id), `${floor}층 보스`);
    const lines = STORY.bosses[boss.id];
    assert.ok(lines && filled(lines.intro) && filled(lines.defeat), `${boss.id} 의 대사`);
  }
  for (const id of Object.keys(STORY.bosses)) assert.ok(Object.hasOwn(BOSSES, id), `없는 보스의 대사: ${id}`);
});

test('이야기: 시작·끝·승리 한 줄(저주 단계마다)·탈방지기·탈마다 한 줄', () => {
  assert.ok(STORY.prologue.length >= 2 && STORY.prologue.every(filled));
  assert.ok(STORY.ending.length >= 2 && STORY.ending.every(filled));
  assert.equal(STORY.victoryLines.length, CURSE.max + 1, '저주 0~최대 단계마다 한 줄');
  assert.ok(STORY.victoryLines.every(filled));
  assert.ok(filled(STORY.keeper.first));
  assert.ok(STORY.keeper.early.length > 0 && STORY.keeper.early.every(filled));
  assert.ok(STORY.keeper.after.length > 0 && STORY.keeper.after.every(filled));
  for (const id of CHARACTER_ORDER) assert.ok(filled(STORY.masks[id]), `${id} 의 한 줄`);
});

test('이야기: 문구는 짧은 평서문이다(~습니다 를 쓰지 않는다)', () => {
  const all = [];
  const walk = (v) => {
    if (typeof v === 'string') all.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(STORY);
  for (const text of all) {
    assert.ok(!/습니다|니다\./.test(text), text);
    assert.ok(text.length <= 60, `너무 길다: ${text}`);
  }
});
