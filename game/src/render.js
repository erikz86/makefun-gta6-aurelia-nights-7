
import {
  BEACH_Y, CHAPTERS, CREW, CREW_ORDER, DIALOG, DISTRICTS, districtIndexAt, FIELD, FONT,
  GARAGE, PALETTE, RADIO, RANKS, rankFor, respectToNext, ROADS_H, ROADS_V, ROAD_W,
  SIDE_TYPES, standingLabel, VEHICLE_TYPES, WATER_Y, WEAPONS, WORLD,
} from './config.js';
import { lerp } from './entities.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_VICTORY = 'victory';
export const SCREEN_GARAGE = 'garage';


export const CAM_HEIGHT = 200;
export const CAM_LOOK = 700;
export const CAM_FOLLOW = 360;
export const CAM_NEAR = 12;
export const CAM_FAR = 2600;

export function makeCamera(width, height) {
  const focal = (height / 2) / Math.tan(0.48);
  const pitch = Math.atan2(CAM_HEIGHT, CAM_LOOK);
  const cam = {
    x: 1600, y: 1200, yaw: 0, camH: CAM_HEIGHT, pitch, focal,
    width, height, horizonY: height / 2 - focal * Math.tan(pitch),
    cosP: 1, sinP: 0, cosY: 1, sinY: 0,
  };
  prepareCamera(cam);
  return cam;
}

export function prepareCamera(cam) {
  cam.cosP = Math.cos(cam.pitch);
  cam.sinP = Math.sin(cam.pitch);
  cam.cosY = Math.cos(cam.yaw);
  cam.sinY = Math.sin(cam.yaw);
  return cam;
}

export function projectPoint(cam, wx, wy, wz) {
  const dx = wx - cam.x;
  const dy = wy - cam.y;
  const depth = dx * cam.cosY + dy * cam.sinY;
  const lat = -dx * cam.sinY + dy * cam.cosY;
  const dz = (wz || 0) - cam.camH;
  const zc = depth * cam.cosP - dz * cam.sinP;
  if (zc < CAM_NEAR) return null;
  const yc = dz * cam.cosP + depth * cam.sinP;
  const s = cam.focal / zc;
  return { x: cam.width / 2 + lat * s, y: cam.height / 2 - yc * s, depth, zc, s };
}

export function groundPoint(cam, sx, sy) {
  const t = (cam.height / 2 - sy) / cam.focal;
  const denom = t * cam.cosP - cam.sinP;
  if (Math.abs(denom) < 1e-6) return null;
  const d = -cam.camH * (cam.cosP + t * cam.sinP) / denom;
  if (!Number.isFinite(d) || d < 0) return null;
  const lat = (sx - cam.width / 2) * d / cam.focal;
  return {
    x: cam.x + cam.cosY * d - cam.sinY * lat,
    y: cam.y + cam.sinY * d + cam.cosY * lat,
    depth: d,
  };
}

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

export function wrapAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function feedDisplay(feed, district) {
  return feed.replace(/pursuit in [A-Z ]+ —/, `pursuit in ${district} —`);
}

export function slotSuffix(w, owned, count) {
  if (!owned) return w.price > 0 ? ` · $${w.price}` : ' · LOCK';
  return w.ammo ? ` ${count}` : '';
}

export function cameraZoom(trauma, speed) {
  return 1 + trauma * 0.05 - Math.min(0.06, Math.abs(speed) / 6000);
}

export function humanoidHeight(radius, s) {
  return Math.min(radius * 2 * s * 1.45, 130);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const cam = makeCamera(FIELD.width, FIELD.height);
  let snapNext = null;
  let yawLock = null;
  let staticLayer = null;
  let lightCanvas = null;
  const sprites = { peds: {}, player: null, glow: null, cone: null, cash: null, ammo: null };
  const fonts = new Map();
  let vignette = null;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
    vignette = null;
  }

  function font(size) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    return fonts.get(size);
  }

  function text(value, x, y, size, color, align, baseline) {
    ctx.font = font(size);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = baseline || 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function drawPortrait(x, y, s) {
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d1a12';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.44, s * 0.42, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(x + s * 0.36, y + s * 0.5, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + s * 0.64, y + s * 0.5, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7a3a2a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.6, s * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }


  function humanoidSprite(color, opts) {
    const c = makeCanvas(28, 56);
    const g = c.getContext('2d');
    const up = opts && opts.armsUp;
    g.fillStyle = '#263238';
    g.fillRect(10, 38, 3, 16);
    g.fillRect(15, 38, 3, 16);
    g.fillStyle = color;
    roundRect(g, 8, 18, 12, 21, 4);
    g.fill();
    if (up) { g.fillRect(4, 6, 3, 13); g.fillRect(21, 6, 3, 13); }
    else { g.fillRect(5, 20, 3, 14); g.fillRect(20, 20, 3, 14); }
    g.fillStyle = '#e8b98a';
    g.beginPath();
    g.arc(14, 11, 6, 0, Math.PI * 2);
    g.fill();
    if (opts && opts.hat) {
      g.fillStyle = '#1a1a1a';
      g.fillRect(7, 4, 14, 3);
      g.fillRect(10, 0, 8, 5);
    }
    if (opts && opts.gun) {
      g.fillStyle = '#111';
      g.fillRect(19, 26, 9, 3);
    }
    return c;
  }

  function radialSprite(size, stops) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function coneSprite() {
    const c = makeCanvas(20, 20);
    const g = c.getContext('2d');
    g.fillStyle = '#ff6d00';
    g.beginPath();
    g.moveTo(10, 1);
    g.lineTo(17, 18);
    g.lineTo(3, 18);
    g.closePath();
    g.fill();
    g.fillStyle = '#fafafa';
    g.fillRect(4, 10, 12, 3);
    return c;
  }

  function cashSprite() {
    const c = makeCanvas(36, 22);
    const g = c.getContext('2d');
    g.fillStyle = '#66bb6a';
    roundRect(g, 1, 1, 34, 20, 3);
    g.fill();
    g.fillStyle = '#1b5e20';
    g.font = 'bold 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$', 18, 12);
    return c;
  }

  function ammoSprite() {
    const c = makeCanvas(28, 22);
    const g = c.getContext('2d');
    g.fillStyle = '#42a5f5';
    roundRect(g, 1, 1, 26, 20, 3);
    g.fill();
    g.fillStyle = '#0d47a1';
    g.fillRect(6, 8, 16, 3);
    g.fillRect(6, 13, 10, 3);
    return c;
  }

  function buildSprites() {
    const cols = ['#e57373', '#81c784', '#64b5f6', '#ffb74d', '#ba68c8'];
    for (let i = 0; i < cols.length; i += 1) sprites.peds[cols[i]] = humanoidSprite(cols[i], { armsUp: i % 2 === 1 });
    sprites.player = humanoidSprite('#64b5f6', { hat: true, gun: true });
    sprites.glow = radialSprite(128, [[0, 'rgba(255, 220, 130, 0.85)'], [1, 'rgba(255, 220, 130, 0)']]);
    sprites.cone = coneSprite();
    sprites.cash = cashSprite();
    sprites.ammo = ammoSprite();
  }


  function buildStatic(state) {
    staticLayer = makeCanvas(WORLD.width, WORLD.height);
    const g = staticLayer.getContext('2d');
    g.fillStyle = PALETTE.ground;
    g.fillRect(0, 0, WORLD.width, BEACH_Y);
    g.fillStyle = PALETTE.water;
    g.fillRect(0, WATER_Y, WORLD.width, WORLD.height - WATER_Y);
    g.fillStyle = PALETTE.sand;
    g.fillRect(0, BEACH_Y, WORLD.width, WATER_Y - BEACH_Y);
    g.fillStyle = PALETTE.plaza;
    g.fillRect(1400, 1900, 400, 140);
    for (const rx of ROADS_V) {
      g.fillStyle = PALETTE.sidewalk;
      g.fillRect(rx - ROAD_W / 2 - 16, 0, ROAD_W + 32, BEACH_Y);
      g.fillStyle = PALETTE.asphalt;
      g.fillRect(rx - ROAD_W / 2, 0, ROAD_W, BEACH_Y);
    }
    for (const ry of ROADS_H) {
      g.fillStyle = PALETTE.sidewalk;
      g.fillRect(0, ry - ROAD_W / 2 - 16, WORLD.width, ROAD_W + 32);
      g.fillStyle = PALETTE.asphalt;
      g.fillRect(0, ry - ROAD_W / 2, WORLD.width, ROAD_W);
    }
    for (const b of state.buildings) {
      g.fillStyle = b.color;
      g.fillRect(b.x, b.y, b.w, b.h);
    }
    g.fillStyle = PALETTE.dock;
    for (const dx of [1150, 1550, 1950]) g.fillRect(dx, 1980, 130, 130);
  }


  function inView(x, y, margin) {
    return !!frustum(x, y, 0, margin);
  }


  function nightFactor(timeOfDay) {
    if (timeOfDay < 0.2) return 0.4;
    if (timeOfDay < 0.55) return 0;
    if (timeOfDay < 0.68) return (timeOfDay - 0.55) / 0.13 * 0.75;
    if (timeOfDay < 0.92) return 1;
    return 1 - (timeOfDay - 0.92) / 0.08 * 0.6;
  }

  function drawLighting(state, quality) {
    const night = nightFactor(state.timeOfDay);
    if (night <= 0.02) return;
    if (!lightCanvas) lightCanvas = makeCanvas(FIELD.width, FIELD.height);
    const lg = lightCanvas.getContext('2d');
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.clearRect(0, 0, FIELD.width, FIELD.height);
    lg.fillStyle = `rgba(6, 8, 20, ${0.55 * night})`;
    lg.fillRect(0, 0, FIELD.width, FIELD.height);
    lg.globalCompositeOperation = 'destination-out';
    const toScreen = (wx, wy, wz) => {
      const pr = projectPoint(cam, wx, wy, wz || 0);
      return pr ? { x: pr.x, y: pr.y } : null;
    };
    const punch = (x, y, r, alpha) => {
      const grad = lg.createRadialGradient(x, y, 4, x, y, r);
      grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = grad;
      lg.beginPath();
      lg.arc(x, y, r, 0, Math.PI * 2);
      lg.fill();
    };
    if (quality < 2) {
      for (const l of state.lights) {
        if (!inView(l.x, l.y, 160)) continue;
        const s = toScreen(l.x, l.y);
        if (s) punch(s.x, s.y, 200, 0.95);
      }
    }
    const p = state.player;
    if (!p.onFoot && state.playerCar) {
      const s = toScreen(p.x, p.y);
      const fx = Math.cos(p.angle);
      const fy = Math.sin(p.angle);
      const rx = -fy;
      const ry = fx;
      const nose = toScreen(p.x + fx * 130, p.y + fy * 130);
      const left = toScreen(p.x + fx * 330 + rx * 90, p.y + fy * 330 + ry * 90);
      const right = toScreen(p.x + fx * 330 - rx * 90, p.y + fy * 330 - ry * 90);
      if (s && nose && left && right) {
        const grad = lg.createRadialGradient(nose.x, nose.y, 10, nose.x, nose.y, 260);
        grad.addColorStop(0, 'rgba(0,0,0,0.95)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        lg.fillStyle = grad;
        lg.beginPath();
        lg.moveTo(s.x, s.y);
        lg.lineTo(left.x, left.y);
        lg.lineTo(right.x, right.y);
        lg.closePath();
        lg.fill();
      }
    }
    for (const c of state.cars) {
      if (c.health >= 30 || !inView(c.x, c.y, 160)) continue;
      const w = toScreen(c.x, c.y);
      if (w) punch(w.x, w.y, 210, 0.8);
    }
    if (state.heli) {
      const s = toScreen(state.heli.x, state.heli.y);
      if (s) punch(s.x, s.y, 180, 0.85);
    }
    lg.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.85 * night;
    ctx.fillStyle = '#ffca28';
    for (const b of state.buildings) {
      if (!inView(b.x + b.w / 2, b.y + b.h / 2, 100)) continue;
      const h3 = 60 + Math.min(150, (b.w + b.h) * 0.22);
      for (const prop of b.props) {
        if (prop.kind !== 'sky') continue;
        const s = toScreen(b.x + prop.dx, b.y + prop.dy, h3 * 0.55);
        if (s) ctx.fillRect(s.x - 8, s.y - 5, 16, 10);
      }
    }
    ctx.restore();
  }

  function drawRain(state, quality) {
    if (!state.rain || quality >= 2) return;
    const t = state.elapsed;
    ctx.strokeStyle = 'rgba(180, 200, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 60; i += 1) {
      const x = ((i * 173 + t * 900) % (FIELD.width + 40)) - 20;
      const y = ((i * 311 + t * 1400) % (FIELD.height + 40)) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 14);
    }
    ctx.stroke();
  }


  function stageText(state) {
    const m = state.mission;
    const ch = CHAPTERS[m.chapter];
    if (ch.type === 'vault') return `${m.phase + 1}/2`;
    if (ch.type === 'collect') return `${Math.min(m.collected + 1, ch.collect)}/${ch.collect}`;
    return '1/1';
  }

  function hintFor(state) {
    const p = state.player;
    if (p.wanted >= 4) return 'LOSE THE HELI — BREAK LINE OF SIGHT';
    if (p.wanted > 0) return 'HIDE IN ALLEYS TO LOSE THE HEAT';
    if (!p.onFoot && state.playerCar && state.playerCar.health < 40) return 'CAR HURT — PRESS R OR CALL SINTA [5]';
    if (p.onFoot) return 'PRESS E TO JACK A NEARBY CAR';
    return 'FOLLOW THE GREEN MARKER';
  }

  const UNIT_NAMES = ['FALCON-2', 'VIPER-7', 'ORCA-3', 'HAWK-5', 'COBRA-1', 'ATLAS-9'];

  function drawHud(state, best, ui) {
    const p = state.player;
    const chapter = CHAPTERS[state.mission.chapter];
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(10, 8, 6, 0.55)';
    roundRect(ctx, 16, 10, 620, 104, 8);
    ctx.fill();
    text(`MISSION ${state.mission.chapter + 1} · ${chapter.name.toUpperCase()}`, 24, 18, 24, PALETTE.text, 'left', 'top');
    text(`TIME ${formatClock(state.elapsed)}`, 628, 20, 18, '#90caf9', 'right', 'top');
    let objective = `STAGE ${stageText(state)} · ${chapter.brief}`;
    if (chapter.type === 'collect' || chapter.type === 'vault') {
      objective += ` — ${state.mission.collected}/${chapter.collect}`;
      if (chapter.type === 'vault' && state.mission.phase === 1) objective = `STAGE 2/2 · Reach the vault`;
    }
    if (chapter.type === 'deliver') objective += ` — ${Math.max(0, Math.ceil(state.mission.timer))}s`;
    text(objective, 24, 46, 18, PALETTE.muted, 'left', 'top');
    if (state.side.active) {
      const a = state.side.active;
      text(`${SIDE_TYPES[a.type].label}: $${a.reward} — ${Math.max(0, Math.ceil(a.timer))}s`, 24, 70, 18, '#ce93d8', 'left', 'top');
    }
    const next = CHAPTERS[state.mission.chapter + 1];
    text(next ? `NEXT: ${next.name}` : 'NEXT: Crown of Aurelia — take the bay', 24, state.side.active ? 94 : 70, 16, '#ffb74d', 'left', 'top');
    const segTotal = chapter.type === 'collect' ? chapter.collect : chapter.type === 'vault' ? 2 : 1;
    const segDone = chapter.type === 'collect' ? Math.min(state.mission.collected + 1, segTotal) : chapter.type === 'vault' ? state.mission.phase + 1 : 1;
    const segW = 220 / segTotal;
    for (let i = 0; i < segTotal; i += 1) {
      ctx.fillStyle = i < segDone ? '#ffca28' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(400 + i * segW + 2, 146, segW - 4, 6);
    }
    const pop = 1 + p.cashPop * 0.35;
    ctx.save();
    ctx.translate(24, 104);
    ctx.scale(pop, pop);
    text(`$${p.cash}`, 0, 0, 30, '#66bb6a', 'left', 'top');
    ctx.restore();
    if (p.combo > 1) {
      text(`COMBO x${p.combo}`, 24, 140, 22, '#ffca28', 'left', 'top');
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(24, 166, 120, 8);
      ctx.fillStyle = '#ffca28';
      ctx.fillRect(24, 166, 120 * (p.comboTimer / 3), 8);
    }
    const crewY = 176;
    ctx.fillStyle = 'rgba(10, 8, 6, 0.62)';
    roundRect(ctx, 16, crewY - 8, 330, 92, 8);
    ctx.fill();
    text('CREW', 24, crewY, 13, '#ffb74d', 'left', 'top');
    for (let i = 0; i < CREW.length; i += 1) {
      const m = CREW[i];
      const cd = state.crew[m.id];
      const ready = cd <= 0;
      const status = ready ? 'READY' : `${Math.ceil(cd)}s`;
      text(`${m.key} · ${m.name.toUpperCase()} — ${m.ability.toUpperCase()}`, 24, crewY + 20 + i * 22, 15, ready ? PALETTE.text : '#8b8378', 'left', 'top');
      text(status, 338, crewY + 20 + i * 22, 15, ready ? '#66bb6a' : '#ff8a65', 'right', 'top');
    }
    text(`HINT: ${hintFor(state)}`, 24, crewY + 96, 15, '#90caf9', 'left', 'top');
    const cx = FIELD.width / 2 + 210;
    ctx.fillStyle = 'rgba(10, 8, 6, 0.55)';
    roundRect(ctx, cx - 190, 12, 380, 140, 8);
    ctx.fill();
    const starY = 24;
    const starSize = 26;
    const starGap = 34;
    const totalW = 5 * starGap;
    const x0 = cx - totalW / 2;
    for (let i = 0; i < 5; i += 1) {
      const filled = i < p.wanted;
      const scale = filled && p.wantedPop > 0 ? 1 + p.wantedPop * 0.4 : 1;
      ctx.save();
      ctx.translate(x0 + i * starGap + starSize / 2, starY + starSize / 2);
      ctx.scale(scale, scale);
      ctx.fillStyle = filled ? '#ffca28' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      for (let k = 0; k < 10; k += 1) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 === 0 ? starSize / 2 : starSize / 4;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (p.wanted > 0) text('WANTED', cx, starY + 34, 14, '#ff5252', 'center', 'top');
    const rank = rankFor(p.respect);
    const curAt = RANKS[rank].at;
    const nextAt = rank + 1 < RANKS.length ? RANKS[rank + 1].at : 999;
    const rpText = `RESPECT LV ${rank + 1} · ${RANKS[rank].name} — ${p.respect}/${nextAt} RP`;
    text(rpText, cx, 84, 15, '#ffca28', 'center', 'top');
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(cx - 100, 106, 200, 8);
    ctx.fillStyle = '#ffca28';
    ctx.fillRect(cx - 100, 106, 200 * Math.min(1, (p.respect - curAt) / Math.max(1, nextAt - curAt)), 8);
    if (state.heli) text('IN SIGHT — Air One has you in the light', cx, 122, 14, '#ff8a65', 'center', 'top');
    else if (p.wanted >= 5) text('AIR UNIT DEPLOYED', cx, 122, 14, '#ff8a65', 'center', 'top');
    const di = districtIndexAt(p.x, p.y);
    const standing = state.districtStanding[di];
    ctx.fillStyle = 'rgba(10, 8, 6, 0.62)';
    roundRect(ctx, 1080, 166, 180, 52, 8);
    ctx.fill();
    text(DISTRICTS[di].name, 1090, 174, 16, '#ffb74d', 'left', 'top');
    text(`${standingLabel(standing)} · ${standing}`, 1090, 196, 15, PALETTE.text, 'left', 'top');
    const boardY = 228;
    const units = [];
    for (let i = 0; i < state.police.length && units.length < 4; i += 1) {
      const c = state.police[i];
      const d = Math.round(Math.hypot(c.x - p.x, c.y - p.y) / 10);
      let tactic = 'PATROL';
      if (c.mode === 'chase') tactic = d < 15 ? 'RAMMING' : 'PURSUE';
      else if (c.mode === 'search') tactic = 'SEARCH';
      else if (c.mode === 'block') tactic = 'BLOCK';
      units.push({ name: UNIT_NAMES[i % UNIT_NAMES.length], tactic, d });
    }
    if (state.heli) units.push({ name: 'AIR-1', tactic: 'SPOTLIGHT', d: Math.round(Math.hypot(state.heli.x - p.x, state.heli.y - p.y) / 10) });
    if (state.roadblocks.length > 0) units.push({ name: 'TIDE-6', tactic: 'ROADBLOCK', d: Math.round(Math.hypot(state.roadblocks[0].x - p.x, state.roadblocks[0].y - p.y) / 10) });
    const hiddenUnits = Math.max(0, state.police.length - 4);
    const boardH = 30 + units.length * 20 + (hiddenUnits > 0 ? 18 : 0) + 34;
    ctx.fillStyle = 'rgba(10, 8, 6, 0.62)';
    roundRect(ctx, 1080, boardY, 180, boardH, 8);
    ctx.fill();
    text(`APD RESPONSE · ${state.police.length + (state.heli ? 1 : 0)} UNITS`, 1090, boardY + 8, 13, '#ff5252', 'left', 'top');
    for (let i = 0; i < units.length; i += 1) {
      const u = units[i];
      text(`${u.name} ${u.tactic}`, 1090, boardY + 30 + i * 20, 14, PALETTE.text, 'left', 'top');
      text(`${u.d}m`, 1252, boardY + 30 + i * 20, 14, '#90caf9', 'right', 'top');
    }
    if (hiddenUnits > 0) text(`+${hiddenUnits} MORE UNITS`, 1090, boardY + 30 + units.length * 20, 13, PALETTE.muted, 'left', 'top');
    const feed = feedDisplay(state.feed || '', DISTRICTS[di].name);
    const words = feed.split(' ');
    let line = '';
    let feedY = boardY + 30 + units.length * 20 + (hiddenUnits > 0 ? 18 : 0) + 4;
    ctx.font = font(12);
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > 164 && line) {
        text(line, 1090, feedY, 12, '#ce93d8', 'left', 'top');
        feedY += 15;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) text(line, 1090, feedY, 12, '#ce93d8', 'left', 'top');
    const car = state.playerCar;
    const armorPct = car ? (car.upgrades.armor || 0) * 15 : 0;
    if (car) text(`${VEHICLE_TYPES[car.type].display} — ${Math.max(0, Math.min(100, Math.round(car.health)))}%`, FIELD.width - 24, FIELD.height - 108, 18, PALETTE.text, 'right', 'top');
    const speed = car ? Math.abs(Math.round(car.speed * 0.12)) : 0;
    ctx.font = font(44);
    const spdW = ctx.measureText(`${speed}`).width;
    text(`${speed}`, FIELD.width - 24, FIELD.height - 88, 44, PALETTE.text, 'right', 'top');
    text('km/h', FIELD.width - 24 - spdW - 10, FIELD.height - 52, 16, PALETTE.muted, 'right', 'top');
    const hp = car ? car.health : p.health;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(FIELD.width - 224, FIELD.height - 36, 200, 10);
    ctx.fillStyle = hp > 50 ? '#66bb6a' : hp > 25 ? '#ffca28' : '#ff5252';
    ctx.fillRect(FIELD.width - 224, FIELD.height - 36, 200 * Math.max(0, Math.min(100, hp)) / 100, 10);
    text(p.onFoot ? `ON FOOT · HEALTH ${Math.max(0, Math.round(p.health))}` : `ARMOR ${armorPct}% · HEALTH ${Math.max(0, Math.round(p.health))}`, FIELD.width - 24, FIELD.height - 20, 14, PALETTE.muted, 'right', 'top');
    const dlg = DIALOG[state.mission.chapter] || DIALOG[0];
    const dlgText = `${dlg.speaker}: "${dlg.line}"`;
    ctx.font = font(15);
    const dlgW = Math.min(860, ctx.measureText(dlgText).width + 76);
    const dlgX = FIELD.width / 2 - dlgW / 2;
    ctx.fillStyle = 'rgba(10, 8, 6, 0.72)';
    roundRect(ctx, dlgX, FIELD.height - 118, dlgW, 34, 8);
    ctx.fill();
    drawPortrait(dlgX + 5, FIELD.height - 116, 30);
    text(dlgText, dlgX + 40 + (dlgW - 40) / 2, FIELD.height - 108, 15, '#ffe082', 'center', 'top');
    const station = RADIO[p.radio];
    const track = station.tracks[Math.floor(state.elapsed / 24) % station.tracks.length];
    text(`♪ ${station.name} · ${track}  [V]`, FIELD.width / 2, FIELD.height - 30, 16, '#90caf9', 'center', 'top');
    text(`${DISTRICTS[di].name} · ${chapter.name.toUpperCase()}`, 24, FIELD.height - 136, 15, '#ffb74d', 'left', 'top');
    const hp2 = Math.max(0, Math.min(100, Math.round(p.health)));
    text('HP', 24, FIELD.height - 114, 12, PALETTE.muted, 'left', 'top');
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(64, FIELD.height - 114, 148, 10);
    ctx.fillStyle = hp2 > 50 ? '#66bb6a' : hp2 > 25 ? '#ffca28' : '#ff5252';
    ctx.fillRect(64, FIELD.height - 114, 148 * hp2 / 100, 10);
    text('ARMOR', 24, FIELD.height - 98, 12, PALETTE.muted, 'left', 'top');
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(64, FIELD.height - 98, 148, 10);
    ctx.fillStyle = '#42a5f5';
    ctx.fillRect(64, FIELD.height - 98, 148 * armorPct / 100, 10);
    text('WEAPONS [Q]', 24, FIELD.height - 78, 13, PALETTE.muted, 'left', 'top');
    const slotW = 92;
    const slotGap = 6;
    for (let i = 0; i < WEAPONS.length; i += 1) {
      const w = WEAPONS[i];
      const owned = state.save.weapons.includes(w.name);
      const sel = p.weapon === i;
      const sx = 24 + i * (slotW + slotGap);
      const sy = FIELD.height - 60;
      ctx.fillStyle = sel ? 'rgba(255,202,40,0.9)' : owned ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      roundRect(ctx, sx, sy, slotW, 30, 6);
      ctx.fill();
      const label = `${i + 1} ${w.name}${slotSuffix(w, owned, w.ammo ? p[w.ammo] : 0)}`;
      text(label, sx + slotW / 2, sy + 8, 13, sel ? '#111' : owned ? PALETTE.text : '#8b8378', 'center', 'top');
    }
    const aw = WEAPONS[p.weapon];
    text(aw.ammo ? `${aw.name} · ${p[aw.ammo]}/${aw.ammoMax}` : `${aw.name} · ∞`, 24, FIELD.height - 22, 14, '#ffca28', 'left', 'top');
    drawMinimap(state);
  }

  function drawMinimap(state) {
    const mw = 180;
    const mh = 135;
    const mx = FIELD.width - mw - 20;
    const my = 20;
    const cx = mx + mw / 2;
    const cy = my + mh / 2;
    const r = mh / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(staticLayer, 0, 0, WORLD.width, WORLD.height, mx, my, mw, mh);
    ctx.globalAlpha = 1;
    const sx = mw / WORLD.width;
    const sy = mh / WORLD.height;
    const dot = (x, y, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx + x * sx, my + y * sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const chapter = CHAPTERS[state.mission.chapter];
    dot(chapter.target.x, chapter.target.y, '#00e676', 4);
    dot(GARAGE.x, GARAGE.y, '#ffb300', 3);
    if (state.side.marker) dot(state.side.marker.x, state.side.marker.y, '#ce93d8', 3);
    for (const c of state.police) dot(c.x, c.y, '#ff1744', 3);
    if (state.heli) dot(state.heli.x, state.heli.y, '#ffee58', 3);
    if (state.elapsed < state.crew.lookoutUntil) {
      for (const pk of state.pickups) {
        if (!pk.active) continue;
        dot(pk.x, pk.y, pk.kind === 'cash' ? '#66bb6a' : '#42a5f5', 2);
      }
    }
    dot(state.player.x, state.player.y, '#ffffff', 4);
    const wedge = (wx, wy) => ({ x: mx + wx * sx, y: my + wy * sy });
    const a = wedge(cam.x, cam.y);
    const wl = wedge(cam.x + Math.cos(cam.yaw - 0.48) * 900, cam.y + Math.sin(cam.yaw - 0.48) * 900);
    const wr = wedge(cam.x + Math.cos(cam.yaw + 0.48) * 900, cam.y + Math.sin(cam.yaw + 0.48) * 900);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(wl.x, wl.y);
    ctx.lineTo(wr.x, wr.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    if (state.elapsed < state.crew.lookoutUntil) text('EYES OUT', cx, my + mh + 4, 11, '#ffee58', 'center', 'top');
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPanel(title, lines, prompt, accent, highlightIdx) {
    const width = 560;
    const lineH = 24;
    const height = 120 + lines.length * lineH + 56;
    const x = (FIELD.width - width) / 2;
    const y = 130;
    ctx.fillStyle = PALETTE.panel;
    roundRect(ctx, x, y, width, height, 12);
    ctx.fill();
    text(title, FIELD.width / 2, y + 56, 44, accent || PALETTE.text, 'center', 'alphabetic');
    if (highlightIdx !== undefined && highlightIdx >= 0 && highlightIdx < lines.length) {
      ctx.fillStyle = 'rgba(255, 202, 40, 0.25)';
      roundRect(ctx, x + 40, y + 118 + highlightIdx * lineH - 22, width - 80, 26, 6);
      ctx.fill();
    }
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], FIELD.width / 2, y + 118 + i * lineH, 20, PALETTE.muted, 'center', 'alphabetic');
    }
    text(prompt, FIELD.width / 2, y + height - 30, 22, '#66bb6a', 'center', 'alphabetic');
  }

  function drawWeaponWheel(state, ui) {
    const p = state.player;
    const cx = FIELD.width / 2;
    const cy = FIELD.height / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    text('WEAPONS — hold Q, press 1-5 or click', cx, cy - 150, 22, PALETTE.text, 'center', 'top');
    for (let i = 0; i < WEAPONS.length; i += 1) {
      const a = -Math.PI / 2 + (i - 2) * (Math.PI / 3);
      const x = cx + Math.cos(a) * 110;
      const y = cy + Math.sin(a) * 110;
      const sel = p.weapon === i;
      const owned = state.save.weapons.includes(WEAPONS[i].name);
      ctx.fillStyle = sel ? 'rgba(255,202,40,0.9)' : owned ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.arc(x, y, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sel ? '#111' : owned ? PALETTE.text : '#8b8378';
      text(WEAPONS[i].name, x, y - 8, 20, sel ? '#111' : owned ? PALETTE.text : '#8b8378', 'center', 'alphabetic');
      let ammo = '';
      if (!owned) ammo = 'LOCK';
      else if (WEAPONS[i].ammo) ammo = `${p[WEAPONS[i].ammo]}`;
      if (ammo !== '') text(ammo, x, y + 18, 18, sel ? '#111' : PALETTE.muted, 'center', 'alphabetic');
    }
  }

  function drawGarage(state, ui) {
    const p = state.player;
    const lines = ['Buy cars, repair and upgrade. Cash: $' + p.cash];
    const rows = [];
    for (const type of Object.keys(VEHICLE_TYPES)) {
      const spec = VEHICLE_TYPES[type];
      const owned = state.save.owned.includes(type);
      rows.push(`${owned ? '✓' : '$' + spec.price}  ${spec.label}  — top ${Math.round(spec.topSpeed * 0.12)} km/h`);
    }
    rows.push('—');
    rows.push('Repair current car: $' + (state.playerCar ? Math.ceil((100 - state.playerCar.health) * 2) : '—'));
    rows.push('Upgrades per car: Speed / Handling / Armor — $200 / $400 / $800 per level');
    rows.push('Upgrades Lv2 need FIXER, Lv3 need SHOT CALLER');
    rows.push('Weapons: 12G $600 (FIXER) · AR-9 $1500 (SHOT CALLER) — press 4 / 5 to buy');
    rows.push('Up / Down to choose, Enter to buy, R repair, 1/2/3 upgrade');
    drawPanel('GARAGE', [...lines, ...rows], 'E to close', '#ffb300', (ui.garageSel || 0) + 1);
  }


  const drawItems = [];

  function pushItem(depth, fn) {
    drawItems.push({ d: depth, fn });
  }

  function polyPts(pts, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
  }

  function toCam3(wx, wy, wz) {
    const dx = wx - cam.x;
    const dy = wy - cam.y;
    const depth = dx * cam.cosY + dy * cam.sinY;
    const lat = -dx * cam.sinY + dy * cam.cosY;
    const dz = (wz || 0) - cam.camH;
    return { lat, yc: dz * cam.cosP + depth * cam.sinP, zc: depth * cam.cosP - dz * cam.sinP, depth };
  }

  function fromCam3(p) {
    const s = cam.focal / p.zc;
    return { x: cam.width / 2 + p.lat * s, y: cam.height / 2 - p.yc * s, s, depth: p.depth };
  }

  function clipNear3(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIn = a.zc >= CAM_NEAR;
      const bIn = b.zc >= CAM_NEAR;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (CAM_NEAR - a.zc) / (b.zc - a.zc);
        out.push({
          lat: a.lat + (b.lat - a.lat) * t,
          yc: a.yc + (b.yc - a.yc) * t,
          zc: CAM_NEAR,
          depth: a.depth + (b.depth - a.depth) * t,
        });
      }
    }
    return out;
  }

  function poly3(corners, fill) {
    const clipped = clipNear3(corners.map((c) => toCam3(c.x, c.y, c.z || 0)));
    if (clipped.length < 3) return;
    polyPts(clipped.map(fromCam3), fill);
  }

  function groundRect(x0, y0, x1, y1, z, fill) {
    poly3([{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }], fill);
  }

  function frustum(x, y, z, margin) {
    const pr = projectPoint(cam, x, y, z || 0);
    if (!pr || pr.depth > CAM_FAR) return null;
    const m = margin || 60;
    if (pr.x < -m || pr.x > FIELD.width + m || pr.y < cam.horizonY - m || pr.y > FIELD.height + m) return null;
    return pr;
  }

  function mixColor(a, b, t) {
    const parse = (c) => {
      if (c.startsWith('#')) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      const m = c.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
    };
    const pa = parse(a);
    const pb = parse(b);
    const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
    const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
    const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function skyColors(t) {
    const stops = [
      [0.0, '#3a2a5e', '#7a4a7d', '#c98a6a'],
      [0.2, '#5aa8d8', '#9fd0e8', '#ffe3b3'],
      [0.55, '#5aa8d8', '#a8d8ea', '#ffe3b3'],
      [0.62, '#6b3a7d', '#ff7e5f', '#feb47b'],
      [0.72, '#3a2350', '#7a3a5e', '#c96a5a'],
      [0.92, '#070d1f', '#141a33', '#3a2350'],
      [1.0, '#070d1f', '#141a33', '#3a2350'],
    ];
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
    const a = stops[i];
    const b = stops[i + 1];
    const f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)));
    return { top: mixColor(a[1], b[1], f), mid: mixColor(a[2], b[2], f), horizon: mixColor(a[3], b[3], f) };
  }

  function drawSky(state) {
    const t = state.timeOfDay;
    const night = nightFactor(t);
    const sky = skyColors(t);
    const grad = ctx.createLinearGradient(0, 0, 0, cam.horizonY + 30);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(0.55, sky.mid);
    grad.addColorStop(1, sky.horizon);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FIELD.width, cam.horizonY + 30);
    if (night > 0.15) {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 70; i += 1) {
        const sx = (i * 137.5) % FIELD.width;
        const sy = (i * 89.3) % Math.max(20, cam.horizonY - 30);
        ctx.globalAlpha = night * (0.25 + ((i * 7) % 5) * 0.15);
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    const sunYaw = -0.25;
    const sun = projectPoint(cam, cam.x + Math.cos(sunYaw) * 4200, cam.y + Math.sin(sunYaw) * 4200, 650);
    const dusk = t > 0.5 && t < 0.75 ? Math.min(1, (t - 0.5) / 0.08) * Math.min(1, (0.75 - t) / 0.08) : 0;
    if (sun && dusk > 0) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 120);
      glow.addColorStop(0, `rgba(255, 200, 120, ${0.85 * dusk})`);
      glow.addColorStop(1, 'rgba(255, 200, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sun.x - 120, sun.y - 120, 240, 240);
      ctx.fillStyle = `rgba(255, 236, 180, ${dusk})`;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, 30, 0, Math.PI * 2);
      ctx.fill();
    }
    if (dusk>0) { const band = ctx.createLinearGradient(0,cam.horizonY-60,0,cam.horizonY+20); band.addColorStop(0,'rgba(255,140,60,0)'); band.addColorStop(0.5,`rgba(255,140,60,${0.35*dusk})`); band.addColorStop(1,'rgba(255,140,60,0)'); ctx.fillStyle=band; ctx.fillRect(0,cam.horizonY-60,FIELD.width,80); }
    if (sun && night > 0.5) {
      ctx.fillStyle = `rgba(230, 235, 255, ${0.9 * night})`;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    const layers = [{n:8,sz:200,al:0.15},{n:5,sz:120,al:0.25},{n:3,sz:80,al:0.35}];
    for (const L of layers) {
      for (let i = 0; i < L.n; i += 1) {
        const c = projectPoint(cam, cam.x + Math.cos(0.6 + i * 1.05) * 3800, cam.y + Math.sin(0.6 + i * 1.05) * 3800, 420 + (i % 3) * 130);
        if (!c || c.y > cam.horizonY - 10 || c.y < -40) continue;
        ctx.fillStyle = night > 0.5 ? `rgba(40, 40, 70, ${L.al * night})` : `rgba(255, 220, 200, ${dusk > 0 ? L.al + 0.15 : L.al})`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, L.sz, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const seaW = Math.max(0, Math.min(1, 1 - Math.abs(wrapAngle(cam.yaw, Math.PI / 2)) / 0.7));
    if (seaW < 1) {
      ctx.fillStyle = `rgba(38, 24, 58, ${(1 - seaW) * 0.85})`;
      ctx.beginPath();
      ctx.moveTo(0, cam.horizonY);
      for (let x = 0; x <= FIELD.width; x += 46) {
        const h = 12 + 30 * Math.abs(Math.sin(x * 0.37 - cam.yaw * 180));
        ctx.lineTo(x, cam.horizonY - h);
        ctx.lineTo(x + 46, cam.horizonY - h);
      }
      ctx.lineTo(FIELD.width, cam.horizonY);
      ctx.closePath();
      ctx.fill();
    }
    if (seaW > 0) {
      const sea = ctx.createLinearGradient(0, cam.horizonY - 4, 0, cam.horizonY + 34);
      sea.addColorStop(0, `rgba(42, 106, 122, ${seaW})`);
      sea.addColorStop(1, `rgba(26, 74, 90, ${seaW})`);
      ctx.fillStyle = sea;
      ctx.fillRect(0, cam.horizonY - 4, FIELD.width, 38);
    }
  }

  function drawGround3d(state) {
    const t = state.timeOfDay;
    const night = nightFactor(t);
    const gg = ctx.createLinearGradient(0, cam.horizonY, 0, FIELD.height);
    gg.addColorStop(0, mixColor(skyColors(t).horizon, PALETTE.ground, 0.55));
    gg.addColorStop(1, night > 0.5 ? shade(PALETTE.ground, 0.52) : PALETTE.ground);
    ctx.fillStyle = gg;
    ctx.fillRect(0, cam.horizonY, FIELD.width, FIELD.height - cam.horizonY);
    const waterCol = night > 0.5 ? shade(PALETTE.water, 0.5) : PALETTE.water;
    const sandCol = night > 0.5 ? shade(PALETTE.sand, 0.55) : PALETTE.sand;
    const sideCol = night > 0.5 ? shade(PALETTE.sidewalk, 0.58) : PALETTE.sidewalk;
    const asphCol = night > 0.5 ? shade(PALETTE.asphalt, 0.62) : PALETTE.asphalt;
    const dashCol = night > 0.5 ? 'rgba(240, 230, 200, 0.5)' : PALETTE.lane;
    for (let x = 0; x < WORLD.width; x += 400) {
      if (!frustum(x + 200, WATER_Y + 150, 0, 200)) continue;
      groundRect(x, WATER_Y, Math.min(WORLD.width, x + 400), WORLD.height, 0, waterCol);
      groundRect(x, BEACH_Y, Math.min(WORLD.width, x + 400), WATER_Y, 0, sandCol);
    }
    for (const rx of ROADS_V) {
      for (let y = 0; y < BEACH_Y; y += 255) {
        const y1 = Math.min(BEACH_Y, y + 255);
        if (!frustum(rx, y + 127, 0, 220)) continue;
        groundRect(rx - ROAD_W / 2 - 16, y, rx + ROAD_W / 2 + 16, y1, 0, sideCol);
        groundRect(rx - ROAD_W / 2, y, rx + ROAD_W / 2, y1, 0, asphCol);
      }
    }
    for (const ry of ROADS_H) {
      for (let x = 0; x < WORLD.width; x += 255) {
        const x1 = Math.min(WORLD.width, x + 255);
        if (!frustum(x + 127, ry, 0, 220)) continue;
        groundRect(x, ry - ROAD_W / 2 - 16, x1, ry + ROAD_W / 2 + 16, 0, sideCol);
        groundRect(x, ry - ROAD_W / 2, x1, ry + ROAD_W / 2, 0, asphCol);
      }
    }
    for (const rx of ROADS_V) {
      for (let y = 20; y < BEACH_Y; y += 56) {
        const pr = frustum(rx, y, 0, 40);
        if (!pr || pr.depth > 1500) continue;
        groundRect(rx - 2, y, rx + 2, y + 26, 0, dashCol);
      }
    }
    for (const ry of ROADS_H) {
      for (let x = 20; x < WORLD.width; x += 56) {
        const pr = frustum(x, ry, 0, 40);
        if (!pr || pr.depth > 1500) continue;
        groundRect(x, ry - 2, x + 26, ry + 2, 0, dashCol);
      }
    }
    for (const rx of ROADS_V) {
      for (const ry of ROADS_H) {
        if (!frustum(rx, ry, 0, 200)) continue;
        for (let i = -4; i <= 4; i += 1) {
          groundRect(rx + i * 12 - 4, ry - ROAD_W / 2 - 12, rx + i * 12 + 4, ry - ROAD_W / 2, 0, 'rgba(255,255,255,0.7)');
          groundRect(rx + i * 12 - 4, ry + ROAD_W / 2, rx + i * 12 + 4, ry + ROAD_W / 2 + 12, 0, 'rgba(255,255,255,0.7)');
        }
      }
    }
    if (frustum(1600, 1970, 0, 300)) groundRect(1400, 1900, 1800, 2040, 0, night > 0.5 ? shade(PALETTE.plaza, 0.5) : PALETTE.plaza);
    for (const dx of [1150, 1550, 1950]) {
      if (!frustum(dx + 65, 2045, 0, 200)) continue;
      groundRect(dx, 1980, dx + 130, 2110, 0, night > 0.5 ? shade(PALETTE.dock, 0.55) : PALETTE.dock);
    }
    if (frustum(1600, 2200, 0, 600)) {
      for (let i = 0; i < 10; i += 1) {
        const wx = 200 + i * 300;
        const wy = WATER_Y + 30 + ((i * 53) % 120);
        groundRect(wx, wy, wx + 46, wy + 8, 0, 'rgba(255,255,255,0.22)');
      }
    }
  }

  function boxAt(cx, cy, angle, len, wid, h, colorTop, colorSide) {
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);
    const rx = -fy;
    const ry = fx;
    const hl = len / 2;
    const hw = wid / 2;
    const c = [
      { x: cx - fx * hl - rx * hw, y: cy - fy * hl - ry * hw },
      { x: cx + fx * hl - rx * hw, y: cy + fy * hl - ry * hw },
      { x: cx + fx * hl + rx * hw, y: cy + fy * hl + ry * hw },
      { x: cx - fx * hl + rx * hw, y: cy - fy * hl + ry * hw },
    ];
    for (let e = 0; e < 4; e += 1) {
      const a = c[e];
      const b = c[(e + 1) % 4];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const nx = ey;
      const ny = -ex;
      const nLen = Math.hypot(nx, ny) || 1;
      const dist = Math.hypot(cam.x - mx, cam.y - my) || 1;
      const cosA = (nx * (cam.x - mx) + ny * (cam.y - my)) / (nLen * dist);
      if (cosA <= 0) continue;
      poly3([
        { x: a.x, y: a.y, z: 0 }, { x: b.x, y: b.y, z: 0 },
        { x: b.x, y: b.y, z: h }, { x: a.x, y: a.y, z: h },
      ], shade(colorSide, 0.55 + 0.35 * cosA));
    }
    poly3([
      { x: c[0].x, y: c[0].y, z: h }, { x: c[1].x, y: c[1].y, z: h },
      { x: c[2].x, y: c[2].y, z: h }, { x: c[3].x, y: c[3].y, z: h },
    ], shade(colorTop, 1.12));
  }

  function drawBuilding(b, night, elapsed) {
    const h3 = 60 + Math.min(150, (b.w + b.h) * 0.22);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    boxAt(cx, cy, 0, b.w, b.h, h3, b.color, b.color);
    const c = [
      { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
    ];
    let best = null;
    for (let e = 0; e < 4; e += 1) {
      const a = c[e];
      const bb = c[(e + 1) % 4];
      const mx = (a.x + bb.x) / 2;
      const my = (a.y + bb.y) / 2;
      const ex = bb.x - a.x;
      const ey = bb.y - a.y;
      const nx = ey;
      const ny = -ex;
      const dist = Math.hypot(cam.x - mx, cam.y - my) || 1;
      const cosA = (nx * (cam.x - mx) + ny * (cam.y - my)) / (Math.hypot(nx, ny) * dist);
      if (cosA > 0.15 && (!best || cosA > best.cosA)) best = { a, b: bb, cosA };
    }
    if (!best) return;
    const pa = projectPoint(cam, best.a.x, best.a.y, 0);
    const pb = projectPoint(cam, best.b.x, best.b.y, 0);
    if (!pa || !pb || Math.abs(pb.x - pa.x) < 34) return;
    const horiz = Math.abs(best.b.x - best.a.x) > Math.abs(best.b.y - best.a.y);
    const baseGlow = 0.15 + 0.85 * night;
    const winCol = (f) => night > 0.4 ? `rgba(255, 213, 79, ${baseGlow * (0.6 + 0.8 * f)})` : `rgba(157, 184, 200, ${0.35 + 0.4 * f})`;
    const wins = b.props.filter((pr) => pr.kind === 'sky').slice(0, 6);
    for (const w of wins) {
      const u = Math.max(0.08, Math.min(0.92, horiz ? w.dx / b.w : w.dy / b.h));
      const v = 0.3 + (horiz ? w.dy / b.h : w.dx / b.w) * 0.5;
      const du = 0.055;
      const dv = 0.085;
      const pt = (uu, vv) => ({
        x: best.a.x + (best.b.x - best.a.x) * uu,
        y: best.a.y + (best.b.y - best.a.y) * uu,
        z: h3 * vv,
      });
      poly3([pt(u - du, v - dv), pt(u + du, v - dv), pt(u + du, v + dv), pt(u - du, v + dv)], winCol(((w.dx * 13 + w.dy * 7) % 10) / 10));
    }
    const SIGNS = ['MANGO & RYE', 'TACO JOINT', 'BAR NEON', 'KOPI 24', 'SURF SHOP', 'RAMEN'];
    const si = ((b.x / 100) | 0) % SIGNS.length;
    if (si % 2 === 0 && Math.abs(pb.x - pa.x) > 80) {
      const mid = projectPoint(cam, best.a.x + (best.b.x - best.a.x) * 0.65, best.a.y + (best.b.y - best.a.y) * 0.65, h3 * 0.85);
      if (mid) {
        const fs = Math.max(9, Math.min(17, Math.abs(pb.x - pa.x) * 0.04));
        ctx.font = font(fs);
        const w = ctx.measureText(SIGNS[si]).width + 14;
        if (w <= Math.abs(pb.x - pa.x)) {
          const dx = pb.x - pa.x, dy = pb.y - pa.y;
          const len = Math.hypot(dx, dy) || 1;
          const signX = mid.x + (-dy / len) * 26 * mid.s;
          const signY = mid.y + (dx / len) * 26 * mid.s;
          ctx.fillStyle = ['#ff7043', '#4fc3f7', '#ab47bc', '#66bb6a', '#ffb300', '#ef5350'][si];
          ctx.globalAlpha = 0.85 + 0.15 * Math.sin(elapsed * 8 + si);
          ctx.fillRect(signX - w / 2, signY - fs, w, fs + 8);
          ctx.globalAlpha = 1;
          text(SIGNS[si], mid.x, mid.y + 2, fs, '#fff', 'center', 'alphabetic');
        }
      }
    }
  }

  function drawCarBox(car, elapsed) {
    const spec = VEHICLE_TYPES[car.type];
    const L = spec.w;
    const Wd = spec.h;
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    const rx = -fy;
    const ry = fx;
    const rearSeen = (cam.x - car.x) * -fx + (cam.y - car.y) * -fy > 0;
    const frontSeen = (cam.x - car.x) * fx + (cam.y - car.y) * fy > 0;
    const face = (df, dr0, dr1, z0, z1) => [
      { x: car.x + fx * df + rx * dr0, y: car.y + fy * df + ry * dr0, z: z0 },
      { x: car.x + fx * df + rx * dr1, y: car.y + fy * df + ry * dr1, z: z0 },
      { x: car.x + fx * df + rx * dr1, y: car.y + fy * df + ry * dr1, z: z1 },
      { x: car.x + fx * df + rx * dr0, y: car.y + fy * df + ry * dr0, z: z1 },
    ];
    const bodyH = car.type === 'van' ? 26 : car.type === 'truck' ? 24 : 20;
    const bodyCol = car.kind === 'police' ? '#eceff1' : spec.color;
    const cabH = car.type === 'van' ? 38 : 32;
    const c4 = (df, dr) => ({ x: car.x + fx * df + rx * dr, y: car.y + fy * df + ry * dr, z: 0.3 });
    poly3([c4(-L / 2 - 6, -Wd / 2 - 6), c4(L / 2 + 6, -Wd / 2 - 6), c4(L / 2 + 6, Wd / 2 + 6), c4(-L / 2 - 6, Wd / 2 + 6)], 'rgba(0,0,0,0.32)');
    if (car.health < 30) {
      const g = projectPoint(cam, car.x, car.y, 4);
      if (g) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#ff6d00';
        ctx.beginPath();
        ctx.arc(g.x, g.y, Math.max(6, 40 * g.s), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (!car._fireParts) car._fireParts = Array.from({length:12},()=>({o:0,life:0}));
      for (const pt of car._fireParts) {
        if (pt.life-- <= 0) { pt.o = Math.random()*44-22; pt.life = 24; }
        const a = projectPoint(cam, car.x + fx * pt.o, car.y + fy * pt.o, 26 + pt.life);
        if (a) { ctx.fillStyle = pt.life > 12 ? '#ff9800' : '#ff5722'; ctx.beginPath(); ctx.arc(a.x, a.y, 4 * a.s, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    boxAt(car.x, car.y, car.angle, L, Wd, bodyH, bodyCol, bodyCol);
    boxAt(car.x - fx * L * 0.04, car.y - fy * L * 0.04, car.angle, L * 0.46, Wd * 0.68, cabH, '#16222e', '#16222e');
    for (const [df, dr] of [[L * 0.32, Wd / 2], [L * 0.32, -Wd / 2], [-L * 0.32, Wd / 2], [-L * 0.32, -Wd / 2]]) {
      boxAt(car.x + fx * df + rx * dr, car.y + fy * df + ry * dr, car.angle, 12, 8, 8, '#111111', '#111111');
    }
    if (car.type === 'sports') {
      const sp = (df, dr, z) => ({ x: car.x + fx * df + rx * dr, y: car.y + fy * df + ry * dr, z });
      poly3([sp(-L / 2 + 2, -Wd * 0.42, bodyH + 5), sp(-L / 2 + 2, Wd * 0.42, bodyH + 5), sp(-L / 2 - 4, Wd * 0.42, bodyH + 5), sp(-L / 2 - 4, -Wd * 0.42, bodyH + 5)], '#1a1a1a');
    }
    if (rearSeen) {
      poly3(face(-L / 2, -Wd * 0.34, -Wd * 0.1, 9, 16), '#ff1744');
      poly3(face(-L / 2, Wd * 0.1, Wd * 0.34, 9, 16), '#ff1744');
      poly3(face(-L / 2, -Wd / 2, Wd / 2, 2, 6), shade(bodyCol, 0.6));
      poly3(face(-L * 0.27, -Wd * 0.26, Wd * 0.26, 23, 30), '#0d1b26');
    }
    if (frontSeen) {
      poly3(face(L / 2, -Wd * 0.34, -Wd * 0.1, 8, 14), '#fff59d');
      poly3(face(L / 2, Wd * 0.1, Wd * 0.34, 8, 14), '#fff59d');
    }
    if (car.kind === 'police') {
      const red = Math.floor(elapsed * 4) % 2 === 0;
      const t1 = projectPoint(cam, car.x - rx * Wd * 0.18, car.y - ry * Wd * 0.18, cabH + 6);
      const t2 = projectPoint(cam, car.x + rx * Wd * 0.18, car.y + ry * Wd * 0.18, cabH + 6);
      if (t1 && t2) {
        ctx.strokeStyle = '#eceff1';
        ctx.lineWidth = Math.max(2, 4 * t1.s);
        ctx.beginPath();
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.stroke();
      }
      if (t1) {
        ctx.fillStyle = red ? '#ff1744' : '#2979ff';
        ctx.beginPath();
        ctx.arc(t1.x, t1.y, Math.max(2, 5 * t1.s), 0, Math.PI * 2);
        ctx.fill();
      }
      if (t2) {
        ctx.fillStyle = red ? '#2979ff' : '#ff1744';
        ctx.beginPath();
        ctx.arc(t2.x, t2.y, Math.max(2, 5 * t2.s), 0, Math.PI * 2);
        ctx.fill();
      }
      const g = projectPoint(cam, car.x, car.y, 26);
      if (g) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(sprites.glow, g.x - 30 * g.s, g.y - 30 * g.s, 60 * g.s, 60 * g.s);
        ctx.globalAlpha = 1;
      }
    }
    if (car.health < 55) {
      const g = projectPoint(cam, car.x, car.y, 30);
      if (g && Math.floor(elapsed * 8) % 2 === 0) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(sprites.glow, g.x - 20 * g.s, g.y - 20 * g.s, 40 * g.s, 40 * g.s);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawPedBillboard(x, y, color, radius, bob, ring, isPlayer) {
    const g = projectPoint(cam, x, y, 0);
    if (!g) return;
    const s = g.s;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, radius * s * 0.9, radius * s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const sprite = isPlayer ? sprites.player : (sprites.peds[color] || sprites.peds['#e57373']);
    const h = humanoidHeight(radius, s);
    const w = h * 0.5;
    ctx.drawImage(sprite, g.x - w / 2, g.y - h + bob * s, w, h);
    if (ring) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, radius * s * 1.1, radius * s * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawMarker3d(x, y, color, label, elapsed) {
    const g = projectPoint(cam, x, y, 0);
    if (!g) return;
    const s = g.s;
    const pulse = 1 + Math.sin(elapsed * 4) * 0.15;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 26 * s * pulse, 13 * s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    const top = projectPoint(cam, x, y, 170);
    if (top) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      const w = Math.max(3, 5 * s);
      ctx.fillRect(top.x - w, top.y, w * 2, g.y - top.y);
      ctx.globalAlpha = 1;
    }
    if (label && g.s > 0.8) text(label, g.x, g.y - 24, 18, color, 'center', 'alphabetic');
  }

  function drawHeli3d(h, elapsed, night, dist) {
    const g = projectPoint(cam, h.x, h.y, 0);
    if (g) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 46 * g.s, 17 * g.s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const bobY = Math.sin(h.bob * 2.2) * 6;
    const body = projectPoint(cam, h.x, h.y, 220 + bobY);
    if (!body) return;
    const sc = body.s * 0.5;
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.rotate(h.angle);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath();
    ctx.ellipse(0, -8 * sc, 52 * sc, 9 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    const rotor = h.bob * 22;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rotor) * -52 * sc, -8 * sc + Math.sin(rotor) * -9 * sc);
    ctx.lineTo(Math.cos(rotor) * 52 * sc, -8 * sc + Math.sin(rotor) * 9 * sc);
    ctx.stroke();
    ctx.fillStyle = '#37474f';
    ctx.fillRect(26 * sc, -3 * sc, 40 * sc, 6 * sc);
    ctx.beginPath();
    ctx.moveTo(66 * sc, -3 * sc);
    ctx.lineTo(66 * sc, -16 * sc);
    ctx.lineTo(74 * sc, -3 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#eceff1';
    ctx.beginPath();
    ctx.ellipse(0, 0, 34 * sc, 15 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#37474f';
    ctx.fillRect(-30 * sc, -2 * sc, 60 * sc, 5 * sc);
    const blink = Math.floor(elapsed * 6) % 2 === 0;
    ctx.fillStyle = blink ? '#ff1744' : '#2979ff';
    ctx.beginPath();
    ctx.arc(0, -14 * sc, 4 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b3e5fc';
    ctx.beginPath();
    ctx.ellipse(-16 * sc, -3 * sc, 11 * sc, 7 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22 * sc, 14 * sc);
    ctx.lineTo(22 * sc, 14 * sc);
    ctx.moveTo(-16 * sc, 14 * sc);
    ctx.lineTo(-16 * sc, 20 * sc);
    ctx.moveTo(16 * sc, 14 * sc);
    ctx.lineTo(16 * sc, 20 * sc);
    ctx.stroke();
    ctx.restore();
    if (g) {
      const la = h.lightAngle;
      const len = dist + 80;
      const p1 = projectPoint(cam, h.x + Math.cos(la + 0.35) * len, h.y + Math.sin(la + 0.35) * len, 0);
      const p2 = projectPoint(cam, h.x + Math.cos(la - 0.35) * len, h.y + Math.sin(la - 0.35) * len, 0);
      const pool = projectPoint(cam, h.x + Math.cos(la) * (dist + 40), h.y + Math.sin(la) * (dist + 40), 0);
      if (p1 && p2) {
        ctx.save();
        const px = pool ? pool.x : (p1.x + p2.x) / 2;
        const py = pool ? pool.y : (p1.y + p2.y) / 2;
        const cg = ctx.createLinearGradient(body.x, body.y, px, py);
        cg.addColorStop(0, 'rgba(255,245,157,0.55)');
        cg.addColorStop(1, 'rgba(255,245,157,0.08)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.moveTo(body.x, body.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawRoadblock3d(rb) {
    const fx = Math.cos(rb.angle);
    const fy = Math.sin(rb.angle);
    for (let i = 0; i < 5; i += 1) {
      const off = (i - 2) * 18;
      boxAt(rb.x + fx * off, rb.y + fy * off, rb.angle, 18, 22, 16, i % 2 === 0 ? '#ff6d00' : '#fafafa', i % 2 === 0 ? '#ff6d00' : '#fafafa');
    }
    for (const sgn of [-1, 1]) {
      const c = projectPoint(cam, rb.x + fx * 60 * sgn, rb.y + fy * 60 * sgn, 0);
      if (c) ctx.drawImage(sprites.cone, c.x - 10 * c.s, c.y - 20 * c.s, 20 * c.s, 20 * c.s);
    }
  }

  function drawPalm3d(x, y) {
    const g = projectPoint(cam, x, y, 0);
    if (!g) return;
    const top = projectPoint(cam, x, y, 95);
    if (!top) return;
    ctx.strokeStyle = '#6d4c41';
    ctx.lineWidth = Math.max(1, 4 * g.s);
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = Math.max(1, 2 * g.s);
    const fronds = 4 + (Math.abs(x * 7 + y * 13) % 4);
    for (let i = 0; i < fronds; i += 1) {
      const a = -0.5 - i * 0.45;
      const tipX = top.x + Math.cos(a) * 32 * g.s;
      const tipY = top.y + 12 * g.s;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.quadraticCurveTo(top.x + Math.cos(a) * 24 * g.s, top.y - 10 * g.s, tipX, tipY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tipX, tipY, 1.5 * g.s, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = '#4e342e';
    ctx.beginPath();
    ctx.arc(top.x, top.y + 4 * g.s, Math.max(1.5, 3 * g.s), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLamp3d(x, y) {
    const g = projectPoint(cam, x, y, 0);
    if (!g) return;
    const top = projectPoint(cam, x, y, 64);
    if (!top) return;
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = Math.max(1, 2 * g.s);
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x-8*g.s, top.y); ctx.lineTo(top.x+8*g.s, top.y); ctx.stroke();
    const cone = ctx.createLinearGradient(top.x,top.y,top.x,top.y+40*g.s); cone.addColorStop(0,'rgba(255,245,157,0.4)'); cone.addColorStop(1,'rgba(255,245,157,0)'); ctx.fillStyle=cone; ctx.fillRect(top.x-20*g.s,top.y,40*g.s,40*g.s);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(sprites.glow, top.x - 16 * g.s, top.y - 16 * g.s, 32 * g.s, 32 * g.s);
    ctx.globalAlpha = 1;
  }

  function drawBoat3d(boat, elapsed) {
    const bob = Math.sin(elapsed * 0.9 + boat.phase) * 3;
    boxAt(boat.x, boat.y, boat.angle, 92, 24, 10, '#eceff1', '#eceff1');
    const fx = Math.cos(boat.angle);
    const fy = Math.sin(boat.angle);
    boxAt(boat.x - fx * 8, boat.y - fy * 8, boat.angle, 16, 14, 10 + bob, '#37474f', '#37474f');
  }

  function drawPickup3d(pk, elapsed) {
    const bob = Math.sin(elapsed * 3 + pk.bob) * 3;
    const g = projectPoint(cam, pk.x, pk.y, 10 + bob);
    if (!g) return;
    const sprite = pk.kind === 'cash' ? sprites.cash : sprites.ammo;
    const s = g.s * 0.9;
    ctx.drawImage(sprite, g.x - (sprite.width / 2) * s, g.y - (sprite.height / 2) * s, sprite.width * s, sprite.height * s);
  }

  function drawSkid3d(s) {
    const fx = Math.cos(s.angle);
    const fy = Math.sin(s.angle);
    const rx = -fy;
    const ry = fx;
    const a = Math.min(0.55, (s.life / 2.5) * 0.55);
    poly3([
      { x: s.x - fx * 16 - rx * 3, y: s.y - fy * 16 - ry * 3, z: 0.2 },
      { x: s.x + fx * 16 - rx * 3, y: s.y + fy * 16 - ry * 3, z: 0.2 },
      { x: s.x + fx * 16 + rx * 3, y: s.y + fy * 16 + ry * 3, z: 0.2 },
      { x: s.x - fx * 16 + rx * 3, y: s.y - fy * 16 + ry * 3, z: 0.2 },
    ], `rgba(20,20,20,${a})`);
  }

  function drawBullet3d(b) {
    const a = projectPoint(cam, b.x - Math.cos(b.angle) * 18, b.y - Math.sin(b.angle) * 18, 6);
    const c = projectPoint(cam, b.x, b.y, 6);
    if (!a || !c) return;
    ctx.strokeStyle = '#ffee58';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }

  function drawParticle3d(pt) {
    const g = projectPoint(cam, pt.x, pt.y, 4);
    if (!g) return;
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(g.x, g.y, Math.max(1, pt.size * g.s), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawObjects3d(state, elapsed, screen) {
    const night = nightFactor(state.timeOfDay);
    const p = state.player;
    drawItems.length = 0;
    const depthOf = (x, y) => (x - cam.x) * cam.cosY + (y - cam.y) * cam.sinY;
    const chapter = CHAPTERS[state.mission.chapter];
    if (chapter.type !== 'collect' || state.mission.phase === 1) {
      pushItem(depthOf(chapter.target.x, chapter.target.y), () => drawMarker3d(chapter.target.x, chapter.target.y, '#00e676', '', elapsed));
    }
    if (state.side.marker) pushItem(depthOf(state.side.marker.x, state.side.marker.y), () => drawMarker3d(state.side.marker.x, state.side.marker.y, '#ce93d8', SIDE_TYPES[state.side.marker.type].label, elapsed));
    if (state.side.active) pushItem(depthOf(state.side.active.tx, state.side.active.ty), () => drawMarker3d(state.side.active.tx, state.side.active.ty, '#ce93d8', '', elapsed));
    if (screen !== SCREEN_GARAGE) pushItem(depthOf(GARAGE.x, GARAGE.y), () => drawMarker3d(GARAGE.x, GARAGE.y, '#ffb300', 'GARAGE', elapsed));
    for (const b of state.buildings) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      if (!frustum(cx, cy, 0, 320)) continue;
      pushItem(depthOf(cx, cy), () => drawBuilding(b, night, elapsed));
    }
    for (const ox of [0, 175]) for (let x = 500 + ox; x < WORLD.width; x += 350) {
      if (!frustum(x, 1990, 0, 120)) continue;
      pushItem(depthOf(x, 1990), () => drawPalm3d(x, 1990));
    }
    if (night > 0.4) {
      for (const rx of ROADS_V) {
        for (let y = 300; y < BEACH_Y; y += 500) {
          if (!frustum(rx + 70, y, 0, 100)) continue;
          pushItem(depthOf(rx + 70, y), () => drawLamp3d(rx + 70, y));
        }
      }
      for (const ry of ROADS_H) {
        for (let x = 300; x < WORLD.width; x += 500) {
          if (!frustum(x, ry + 70, 0, 100)) continue;
          pushItem(depthOf(x, ry + 70), () => drawLamp3d(x, ry + 70));
        }
      }
      for (let x = 600; x < WORLD.width; x += 500) {
        if (!frustum(x, 1990, 0, 100)) continue;
        pushItem(depthOf(x, 1990), () => drawLamp3d(x, 1990));
      }
    }
    for (const boat of state.boats) {
      if (!frustum(boat.x, boat.y, 0, 120)) continue;
      pushItem(depthOf(boat.x, boat.y), () => drawBoat3d(boat, elapsed));
    }
    for (const pk of state.pickups) {
      if (!pk.active || !frustum(pk.x, pk.y, 0, 40)) continue;
      pushItem(depthOf(pk.x, pk.y), () => drawPickup3d(pk, elapsed));
    }
    for (const s of state.skids) {
      if (!s.active || !frustum(s.x, s.y, 0, 40)) continue;
      pushItem(depthOf(s.x, s.y), () => drawSkid3d(s));
    }
    for (const car of state.cars) {
      if (car === state.playerCar || !frustum(car.x, car.y, 0, 90)) continue;
      pushItem(depthOf(car.x, car.y), () => {
        drawCarBox(car, elapsed);
        if (car.owned && screen !== SCREEN_GARAGE) {
          const g = projectPoint(cam, car.x, car.y, 0);
          if (g) {
            ctx.strokeStyle = '#ffca28';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(g.x, g.y, 46 * g.s, 20 * g.s, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      });
    }
    for (const c of state.police) {
      if (!frustum(c.x, c.y, 0, 90)) continue;
      pushItem(depthOf(c.x, c.y), () => drawCarBox(c, elapsed));
    }
    for (const ped of state.peds) {
      if (!frustum(ped.x, ped.y, 0, 40)) continue;
      const bob = Math.sin(ped.walkPhase) * 2;
      pushItem(depthOf(ped.x, ped.y), () => drawPedBillboard(ped.x, ped.y, ped.color, 14, bob, false));
    }
    for (const rb of state.roadblocks) {
      if (!frustum(rb.x, rb.y, 0, 120)) continue;
      pushItem(depthOf(rb.x, rb.y), () => drawRoadblock3d(rb));
    }
    if (!p.onFoot && state.playerCar) {
      const car = state.playerCar;
      if (frustum(car.x, car.y, 0, 90)) pushItem(depthOf(car.x, car.y), () => drawCarBox(car, elapsed));
    } else if (frustum(p.x, p.y, 0, 40)) {
      pushItem(depthOf(p.x, p.y), () => drawPedBillboard(p.x, p.y, '#64b5f6', 18, 0, true, true));
    }
    for (const b of state.bullets) {
      if (!b.active) continue;
      pushItem(depthOf(b.x, b.y), () => drawBullet3d(b));
    }
    if (state.heli) {
      const h = state.heli;
      pushItem(depthOf(h.x, h.y), () => drawHeli3d(h, elapsed, night, Math.hypot(p.x - h.x, p.y - h.y)));
    }
    for (const pt of state.particles) {
      if (!pt.active || !frustum(pt.x, pt.y, 0, 30)) continue;
      pushItem(depthOf(pt.x, pt.y), () => drawParticle3d(pt));
    }
    drawItems.sort((a, b) => b.d - a.d);
    for (const it of drawItems) it.fn();
  }


  function drawWorld(state, ui) {
    const p = state.player;
    const elapsed = state.elapsed;
    const car = state.playerCar;
    let targetYaw = p.onFoot ? p.angle : (car ? car.angle : p.angle);
    let targetH = p.onFoot ? 160 : 200;
    if (ui.screen === SCREEN_TITLE) {
      const tx = 1600 + Math.cos(elapsed * 0.07) * 900;
      const ty = 1250 + Math.sin(elapsed * 0.05) * 450;
      cam.x = tx;
      cam.y = ty;
      cam.yaw = Math.atan2(1250 - ty, 1600 - tx);
      cam.camH = 280;
      prepareCamera(cam);
      snapNext = null;
    } else if (snapNext) {
      const yaw = snapNext.yaw !== undefined ? snapNext.yaw : targetYaw;
      if (snapNext.yaw !== undefined) yawLock = snapNext.yaw;
      const follow = p.onFoot ? 230 : CAM_FOLLOW;
      cam.x = snapNext.x - Math.cos(yaw) * follow;
      cam.y = snapNext.y - Math.sin(yaw) * follow;
      cam.yaw = yaw;
      cam.camH = snapNext.camH !== undefined ? snapNext.camH : targetH;
      prepareCamera(cam);
      snapNext = null;
    } else {
      if (yawLock !== null) targetYaw = yawLock;
      const fx = Math.cos(targetYaw);
      const fy = Math.sin(targetYaw);
      cam.x = lerp(cam.x, p.x - fx * CAM_FOLLOW, 0.08);
      cam.y = lerp(cam.y, p.y - fy * CAM_FOLLOW, 0.08);
      cam.yaw += wrapAngle(cam.yaw, targetYaw) * 0.12;
      cam.camH = lerp(cam.camH, targetH, 0.1);
      prepareCamera(cam);
    }
    cam.x = Math.max(100, Math.min(WORLD.width - 100, cam.x));
    cam.y = Math.max(100, Math.min(WORLD.height - 100, cam.y));
    const shake = state.trauma * state.trauma * 14;
    const shx = shake > 0.1 ? Math.sin(elapsed * 61) * shake : 0;
    const shy = shake > 0.1 ? Math.cos(elapsed * 57) * shake : 0;
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.save();
    ctx.translate(shx, shy);
    const zoom = cameraZoom(state.trauma, state.playerCar ? state.playerCar.speed : 0);
    const speedF = Math.min(1, Math.abs(car ? car.speed : 0) / 400);
    cam.focal = (FIELD.height / 2) / Math.tan(0.48 - speedF * 0.15);
    cam.horizonY = FIELD.height / 2 - cam.focal * Math.tan(cam.pitch);
    ctx.translate(FIELD.width / 2, FIELD.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-FIELD.width / 2, -FIELD.height / 2);
    drawSky(state);
    drawGround3d(state);
    drawObjects3d(state, elapsed, ui.screen);
    ctx.restore();

    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawRain(state, ui.quality);
    drawLighting(state, ui.quality);
    const night = nightFactor(state.timeOfDay);
    if (state.timeOfDay > 0.55 && state.timeOfDay < 0.72) {
      ctx.fillStyle = 'rgba(255, 120, 80, 0.22)';
      ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    }
    if (!vignette) {
      vignette = ctx.createRadialGradient(FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.45, FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.85);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    if (state.damageFlash > 0) {
      ctx.fillStyle = `rgba(255, 30, 30, ${state.damageFlash * 0.28})`;
      ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    }
    if (night > 0.02) {
      ctx.fillStyle = `rgba(20, 40, 90, ${night * 0.06})`;
      ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  function draw(state, screen, best, ui) {
    ui = ui || {};
    if (!staticLayer) {
      buildSprites();
      buildStatic(state);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawWorld(state, { screen, quality: ui.quality || 0 });
    if (screen === SCREEN_TITLE) {
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      ctx.fillStyle = 'rgba(5, 8, 16, 0.30)';
      ctx.fillRect(0, 0, FIELD.width, FIELD.height);
      const grad = ctx.createLinearGradient(0, 150, 0, 320);
      grad.addColorStop(0, '#ffe082');
      grad.addColorStop(0.5, '#ff7043');
      grad.addColorStop(1, '#ab47bc');
      ctx.save();
      ctx.shadowColor = 'rgba(255, 112, 67, 0.8)';
      ctx.shadowBlur = 34;
      text('AURELIA NIGHTS VII', FIELD.width / 2, 250, 64, grad, 'center', 'alphabetic');
      ctx.restore();
      text('A 3D open-world crime game in Aurelia Bay', FIELD.width / 2, 300, 24, PALETTE.text, 'center', 'alphabetic');
      text(`Best cash $${best}   ·   10 chapters, crew of 3, side missions, helicopter, garage, radio`, FIELD.width / 2, 336, 18, PALETTE.muted, 'center', 'alphabetic');
      const pulse = 0.6 + Math.sin(state.elapsed * 3) * 0.4;
      ctx.globalAlpha = pulse;
      text('Press Enter to start', FIELD.width / 2, 420, 28, '#66bb6a', 'center', 'alphabetic');
      ctx.globalAlpha = 1;
      text('WASD drive / walk · E enter car · Q weapons · 1-5 select · 4/5/6 crew · V radio · R repair · P pause', FIELD.width / 2, 470, 18, PALETTE.muted, 'center', 'alphabetic');
      return;
    }
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawHud(state, best, ui);
    if (ui.wheel) drawWeaponWheel(state, ui);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', [`Quality: ${['High', 'Medium', 'Low'][ui.quality || 0]}  ·  FPS ${Math.round(ui.fps || 60)}`, 'The city waits for you.'], 'Press P to resume');
    } else if (screen === SCREEN_GARAGE) {
      drawGarage(state, ui);
    } else if (screen === SCREEN_OVER) {
      const title = state.busted ? 'BUSTED!' : state.victory ? 'KING OF THE BAY!' : 'Wrecked!';
      const lines = [
        `Cash $${state.player.cash}  ·  Best $${Math.max(best, state.player.cash)}`,
        `Chapters cleared: ${state.stats.chapters}  ·  Pickups: ${state.stats.pickups}`,
      ];
      drawPanel(title, lines, 'Press Enter to play again', state.busted ? '#ff5252' : '#66bb6a');
    } else if (screen === SCREEN_VICTORY) {
      const lines = [
        `Cash $${state.player.cash}  ·  Best $${Math.max(best, state.player.cash)}`,
        `Near misses: ${state.stats.nearMisses}  ·  Drifts: ${state.stats.drifts}  ·  Shots hit: ${state.stats.hits}/${state.stats.shots}`,
        'All 10 chapters cleared. Aurelia Bay is yours.',
      ];
      drawPanel('KING OF THE BAY!', lines, 'Press Enter to play again', '#ffca28');
    }
    if (screen === SCREEN_PLAY && state.mission.intro > 0) {
      const chapter = CHAPTERS[state.mission.chapter];
      const alpha = Math.min(1, state.mission.intro);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(5, 8, 16, 0.55)';
      ctx.fillRect(0, 220, FIELD.width, 150);
      text(`CHAPTER ${state.mission.chapter + 1}`, FIELD.width / 2, 268, 22, '#ffca28', 'center', 'alphabetic');
      text(chapter.name, FIELD.width / 2, 318, 44, PALETTE.text, 'center', 'alphabetic');
      text(chapter.brief, FIELD.width / 2, 352, 20, PALETTE.muted, 'center', 'alphabetic');
      ctx.restore();
    }
  }

  function snapCamera(x, y, yaw, camH) {
    snapNext = { x, y, yaw, camH };
    if (yaw !== undefined) yawLock = yaw;
  }

  function screenToField(cssX, cssY) {
    const ratio = canvas.width / Math.max(1, window.innerWidth);
    return {
      x: (cssX * ratio - view.x) / view.scale,
      y: (cssY * ratio - view.y) / view.scale,
    };
  }

  function screenToWorld(cssX, cssY) {
    const f = screenToField(cssX, cssY);
    const g = groundPoint(cam, f.x, f.y);
    if (!g) return { x: cam.x, y: cam.y };
    return { x: g.x, y: g.y };
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, snapCamera, screenToField, screenToWorld };
}
