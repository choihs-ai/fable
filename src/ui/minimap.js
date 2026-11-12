// 미니맵: 드러난 방과 복도를 작은 캔버스에 그린다. 지금 있는 방, 전투 중인 방, 깬 방, 방의 종류를 색으로 구분한다.
// 방이 드러나거나 상태가 바뀔 때만 다시 그리고, 플레이어 점은 프레임마다 옮긴다.

import { h } from './dom.js';

const COLORS = {
  start: '#8fa3b8', combat: '#a8a8b8', elite: '#e86a4a', reward: '#e8d8ff', shop: '#7fd18b', boss: '#ff4a3a', exit: '#7fe0ff', bonus: '#c79bff',
};

/**
 * @param {HTMLElement} parent
 * @returns {{ el:HTMLElement, update:(state:object, currentRoom:number|null) => void }}
 */
export function createMinimap(parent) {
  const canvas = h('canvas', { class: 'minimap', width: 120, height: 120 });
  const dot = h('div', { class: 'minimap-dot' });
  const el = h('div', { class: 'minimap-box' }, canvas, dot);
  parent.append(el);
  const ctx = canvas.getContext('2d');
  let drawnSig = '';
  let view = { scale: 1, ox: 0, oy: 0 };

  function draw(world, current) {
    const rooms = world.rooms.filter((r) => r.seen);
    const w = canvas.width;
    const hgt = canvas.height;
    ctx.clearRect(0, 0, w, hgt);
    if (rooms.length === 0) return;
    // 맵 전체가 들어가게 맞춘다(드러나지 않은 방이 있어도 축척은 맵 크기로 고정 — 방이 드러날 때 그림이 흔들리지 않게).
    const scale = Math.min((w - 8) / world.width, (hgt - 8) / world.height);
    view = { scale, ox: (w - world.width * scale) / 2, oy: (hgt - world.height * scale) / 2 };
    const X = (x) => view.ox + x * scale;
    const Y = (y) => view.oy + y * scale;
    // 복도
    ctx.strokeStyle = 'rgba(200,200,220,0.55)';
    ctx.lineWidth = Math.max(1.5, scale * 1.2);
    for (const link of world.links) {
      if (!link.seen) continue;
      const [a, b] = link.doors.map((id) => world.doors[id]);
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
    }
    // 방
    for (const room of rooms) {
      const color = COLORS[room.kind] ?? '#aaa';
      ctx.globalAlpha = room.state === 'cleared' ? 0.45 : 0.85;
      ctx.fillStyle = room.state === 'active' ? '#ff5a3a' : color;
      ctx.fillRect(X(room.x), Y(room.y), room.w * scale, room.h * scale);
      ctx.globalAlpha = 1;
      if (room.id === current) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(X(room.x) - 1, Y(room.y) - 1, room.w * scale + 2, room.h * scale + 2);
      }
    }
  }

  return {
    el,
    update(state, current) {
      const world = state.world;
      if (!world) return;
      const sig = `${world.rooms.map((r) => (r.seen ? r.state[0] : '-')).join('')}|${world.links.map((l) => (l.seen ? 1 : 0)).join('')}|${current}`;
      if (sig !== drawnSig) {
        drawnSig = sig;
        draw(world, current);
      }
      const player = state.entities.byId[state.playerId];
      if (player) {
        const k = canvas.clientWidth / canvas.width || 1;
        dot.style.transform = `translate(${(view.ox + player.x * view.scale) * k}px, ${(view.oy + player.y * view.scale) * k}px)`;
      }
    },
    reset() {
      drawnSig = '';
    },
  };
}
