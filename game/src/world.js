// The game's rules and state, with no drawing and no browser in it: the player
// (on foot or driving), traffic, pedestrians, police AI, the helicopter, roadblocks,
// weapons, the garage, radio, cash and combo, the day-night cycle, particles and
// skid marks. step() advances one fixed step and returns what happened as bit
// flags, so the caller can react without the world knowing about screens or sound.
// Nothing here allocates after createWorld returns (fixed pools, reused scratch).

import {
  BEACH_Y, CHAPTERS, COMBO, CREW, CREW_ORDER, DISTRICTS, districtIndexAt, GARAGE, PALETTE, PED_COUNT,
  PLAYER, POLICE, POOL_SIZE, RANKS, rankFor, REPAIR_CASH_PER_HP, RESPECT_MAX,
  ROADS_H, ROADS_V, ROAD_W, SAVE_KEY, SIDE_TYPES, TRAFFIC_COUNT, UPGRADE_COSTS,
  VEHICLE_ORDER, VEHICLE_TYPES, WATER_Y, WEAPONS, WORLD,
} from './config.js';
import {
  angleDiff, angleTo, armorSoak, carGrip, carTopSpeed, clamp, circleHit, createAmmoPickup,
  createBullet, createCashPickup, createHelicopter, createParticle, createPedestrian,
  createPolice, createRoadblock, createSkid, createVehicle, dist2, lerp,
} from './entities.js';
import {
  createMissionState, createSideState, offerSideMarker, startChapter,
  startSideMission, updateMissions, updateSideMission,
} from './missions.js';

export const EVENT_HIT = 1;
export const EVENT_OVER = 2;
export const EVENT_CHAPTER = 4;
export const EVENT_PICKUP = 8;
export const EVENT_BUSTED = 16;
export const EVENT_SIDE = 32;
export const EVENT_WANTED = 64;
export const EVENT_EMPTY = 128;

/** A zeroed input object: every field optional, missing means off. */
export function blankInput() {
  return {
    mx: 0, my: 0, accel: false, brake: false, steer: 0, handbrake: false,
    enter: false, fire: false, aimX: 0, aimY: 0, weapon: null, crew: null, radio: false,
    repair: false, garage: false, wheel: false,
  };
}

function buildingAt(rng, bx, by, bw, bh) {
  const w = rng.range(90, Math.min(220, bw - 30));
  const h = rng.range(70, Math.min(160, bh - 30));
  const x = bx + rng.range(15, Math.max(16, bw - w - 15));
  const y = by + rng.range(15, Math.max(16, bh - h - 15));
  const props = [];
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i += 1) {
    props.push({ dx: rng.range(0.15, 0.8) * w, dy: rng.range(0.15, 0.8) * h, kind: rng.choice(['vent', 'ac', 'pool', 'sky']) });
  }
  return { x, y, w, h, color: rng.choice(PALETTE.building), props };
}

export function createWorld(random) {
  const rng = random;
  const state = {
    rng,
    elapsed: 0,
    timeOfDay: 0.06,
    rain: false,
    paused: false,
    over: false,
    busted: false,
    victory: false,
    player: {
      x: 500, y: 500, angle: -Math.PI / 2, onFoot: true,
      health: PLAYER.health, cash: 0, combo: 1, comboTimer: 0,
      wanted: 0, wantedFloat: 0, hiddenTimer: 0, weapon: 0,
      ammoPistol: 24, ammoSmg: 90, ammoShotgun: 0, ammoAr: 0,
      fireCd: 0, invuln: 0, bustTimer: 0,
      radio: 0, muted: false, cashPop: 0, wantedPop: 0, respect: 0,
    },
    playerCar: null,
    cars: [],
    peds: [],
    police: [],
    heli: null,
    roadblocks: [],
    pickups: [],
    bullets: [],
    particles: [],
    skids: [],
    buildings: [],
    lights: [],
    palms: [],
    parked: [],
    boats: [],
    mission: createMissionState(),
    side: createSideState(),
    /** Crew cooldowns (seconds left) + Lookout's minimap reveal window (elapsed time). */
    crew: { driver: 0, mechanic: 0, lookout: 0, lookoutUntil: 0 },
    /** District standing 0..100 per DISTRICTS index; 50 = NEUTRAL. */
    districtStanding: [50, 50, 50, 50, 50],
    /** The dispatch feed's last live line (set by real events: pursuit, pickup, chapter). */
    feed: 'APD DISPATCH: Aurelia Bay quiet — patrols on routine rounds.',
    garageOpen: false,
    garageSel: 0,
    trauma: 0,
    damageFlash: 0,
    stats: { shots: 0, hits: 0, nearMisses: 0, drifts: 0, pickups: 0, chapters: 0 },
    save: { bestCash: 0, bestScore: 0, chapter: 0, owned: ['sedan'], upgrades: { sedan: { speed: 0, handling: 0, armor: 0 } }, weapons: ['Fists', '.38', 'SMG'] },
  };
  for (let i = 0; i < POOL_SIZE; i += 1) state.particles.push(createParticle());
  for (let i = 0; i < 128; i += 1) state.skids.push(createSkid());

  // ---------------------------------------------------------- generation

  function nearestRoadPoint(x, y) {
    let best = null;
    let bd = Infinity;
    for (const rx of ROADS_V) for (const ry of ROADS_H) {
      const d = dist2(x, y, rx, ry);
      if (d < bd) { bd = d; best = { x: rx, y: ry }; }
    }
    return best;
  }

  function roadPoint() {
    if (rng.next() < 0.5) return { x: rng.choice(ROADS_V), y: rng.range(200, 1950) };
    return { x: rng.range(200, 3000), y: rng.choice(ROADS_H) };
  }

  function generate() {
    state.buildings = [];
    state.lights = [];
    state.palms = [];
    state.parked = [];
    state.boats = [];
    const xBands = [[40, 340], [460, 940], [1060, 1540], [1660, 2140], [2260, 2740], [2860, 3160]];
    const yBands = [[40, 340], [460, 840], [960, 1340], [1460, 1840]];
    for (const [bx0, bx1] of xBands) {
      for (const [by0, by1] of yBands) {
        // Keep the garage corner clear for its lot.
        if (bx0 === 2860 && by0 === 40) continue;
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i += 1) {
          state.buildings.push(buildingAt(rng, bx0, by0, bx1 - bx0, by1 - by0));
        }
      }
    }
    // The garage building, beside its lot.
    state.buildings.push({ x: 2880, y: 120, w: 220, h: 130, color: '#7a5a42', props: [{ dx: 40, dy: 40, kind: 'vent' }] });
    for (const rx of ROADS_V) {
      for (const ry of ROADS_H) {
        state.lights.push({ x: rx + ROAD_W / 2 + 12, y: ry - ROAD_W / 2 - 12 });
        state.lights.push({ x: rx - ROAD_W / 2 - 12, y: ry + ROAD_W / 2 + 12 });
      }
    }
    for (let i = 0; i < 46; i += 1) {
      state.palms.push({ x: rng.range(60, 3140), y: rng.range(BEACH_Y - 60, BEACH_Y + 4), s: rng.range(0.8, 1.3) });
    }
    for (let i = 0; i < 8; i += 1) {
      const at = roadPoint();
      state.parked.push({ type: rng.choice(['sedan', 'taxi', 'van']), x: at.x, y: at.y, angle: rng.choice([0, Math.PI / 2, Math.PI, -Math.PI / 2]) });
    }
    for (let i = 0; i < 3; i += 1) {
      state.boats.push({ x: 900 + i * 620, y: WATER_Y + 90 + rng.range(0, 120), angle: rng.range(-0.2, 0.2), phase: rng.range(0, Math.PI * 2) });
    }
  }

  function spawnTrafficCar() {
    const at = roadPoint();
    const car = createVehicle(rng.choice(['sedan', 'taxi', 'van', 'truck']), at.x, at.y, 0);
    car.topSpeed = rng.range(120, 190);
    car.wp = nearestRoadPoint(at.x, at.y);
    car.parked = false;
    return car;
  }

  function spawnPed() {
    const at = roadPoint();
    const ped = createPedestrian(at.x + rng.range(-40, 40), at.y + rng.range(-40, 40), rng.choice(['#e57373', '#81c784', '#64b5f6', '#ffb74d', '#ba68c8']));
    ped.tx = ped.x;
    ped.ty = ped.y;
    return ped;
  }

  function spawnCashNear(x, y, value) {
    for (const p of state.pickups) {
      if (!p.active && p.kind === 'cash') {
        p.active = true; p.x = clamp(x, 60, WORLD.width - 60); p.y = clamp(y, 60, WATER_Y - 40); p.value = value; p.bob = 0;
        return p;
      }
    }
    return null;
  }

  function spawnAmmoNear(x, y) {
    for (const p of state.pickups) {
      if (!p.active && p.kind === 'ammo') {
        p.active = true; p.x = clamp(x, 60, WORLD.width - 60); p.y = clamp(y, 60, WATER_Y - 40); p.bob = 0;
        return p;
      }
    }
    return null;
  }

  function spawnParticle(x, y, vx, vy, life, size, color) {
    for (const p of state.particles) {
      if (p.active) continue;
      p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.max = life; p.size = size; p.color = color; p.drag = 0.92;
      return;
    }
  }

  function spawnSkid(x, y, angle) {
    for (const s of state.skids) {
      if (s.active) continue;
      s.active = true; s.x = x; s.y = y; s.angle = angle; s.life = 2.5;
      return;
    }
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i += 1) {
      const a = rng.range(0, Math.PI * 2);
      const v = rng.range(speed * 0.3, speed);
      spawnParticle(x, y, Math.cos(a) * v, Math.sin(a) * v, rng.range(0.3, 0.9), rng.range(2, 5), color);
    }
  }

  function nearestPed(x, y) {
    let best = null;
    let bd = Infinity;
    for (const p of state.peds) {
      if (p.inTaxi) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------- reset

  function reset() {
    generate();
    const p = state.player;
    // Spawn on the x=400 road, facing south toward the harbour: the first drive
    // follows real roads (south, then east along y=1650). The starter sedan sits
    // on the same road 60px ahead so E enters it immediately.
    p.x = 400; p.y = 490; p.angle = Math.PI / 2; p.onFoot = true;
    p.health = PLAYER.health; p.cash = 0; p.combo = 1; p.comboTimer = 0;
    p.wanted = 0; p.wantedFloat = 0; p.hiddenTimer = 0; p.weapon = 0;
    p.ammoPistol = 24; p.ammoSmg = 90; p.ammoShotgun = 0; p.ammoAr = 0;
    p.fireCd = 0; p.invuln = 0; p.bustTimer = 0;
    p.radio = 0; p.muted = false; p.cashPop = 0; p.wantedPop = 0; p.respect = 0;
    state.playerCar = null;
    state.cars = [];
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) state.cars.push(spawnTrafficCar());
    // A sedan parked by the spawn point so the first 30 seconds hook immediately.
    const starter = createVehicle('sedan', 400, 550, Math.PI / 2);
    starter.parked = true;
    state.cars.push(starter);
    state.peds = [];
    for (let i = 0; i < PED_COUNT; i += 1) state.peds.push(spawnPed());
    state.police = [];
    for (let i = 0; i < POLICE.patrolCount; i += 1) {
      const at = roadPoint();
      state.police.push(createPolice(at.x, at.y));
    }
    state.heli = null;
    state.roadblocks = [];
    state.pickups = [];
    for (let i = 0; i < 16; i += 1) state.pickups.push(createCashPickup(0, 0, 50));
    for (let i = 0; i < 4; i += 1) state.pickups.push(createAmmoPickup(0, 0));
    for (const pk of state.pickups) pk.active = false;
    for (let i = 0; i < 8; i += 1) spawnCashNear(rng.range(300, 2900), rng.range(300, 1800), 50);
    for (let i = 0; i < 2; i += 1) spawnAmmoNear(rng.range(300, 2900), rng.range(300, 1800));
    state.bullets = [];
    for (const pt of state.particles) pt.active = false;
    for (const s of state.skids) s.active = false;
    state.mission = createMissionState();
    state.side = createSideState();
    state.crew = { driver: 0, mechanic: 0, lookout: 0, lookoutUntil: 0 };
    state.districtStanding = [50, 50, 50, 50, 50];
    state.feed = 'APD DISPATCH: Aurelia Bay quiet — patrols on routine rounds.';
    state.garageOpen = false;
    state.garageSel = 0;
    state.trauma = 0;
    state.damageFlash = 0;
    state.stats = { shots: 0, hits: 0, nearMisses: 0, drifts: 0, pickups: 0, chapters: 0 };
    state.elapsed = 0;
    state.over = false;
    state.busted = false;
    state.victory = false;
    startChapter(api, 0);
  }

  // ---------------------------------------------------------- helpers

  function resolveBuildings(x, y, r) {
    // Push a circle out of every building rect it overlaps; returns true on a hit.
    let hit = false;
    for (const b of state.buildings) {
      const cx = clamp(x, b.x, b.x + b.w);
      const cy = clamp(y, b.y, b.y + b.h);
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 === 0) {
        // Centre inside the rect: push out along the smallest penetration.
        const pl = x - b.x;
        const pr = b.x + b.w - x;
        const pt = y - b.y;
        const pb = b.y + b.h - y;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) return { x: b.x - r, y, hit: true };
        if (m === pr) return { x: b.x + b.w + r, y, hit: true };
        if (m === pt) return { x, y: b.y - r, hit: true };
        return { x, y: b.y + b.h + r, hit: true };
      }
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      return { x: x + dx * push, y: y + dy * push, hit: true };
    }
    return { x, y, hit };
  }

  function damagePlayer(amount, sourceX, sourceY) {
    const p = state.player;
    if (p.invuln > 0 || state.over) return 0;
    p.invuln = 0.5;
    p.combo = 1;
    p.comboTimer = 0;
    state.damageFlash = 1;
    state.trauma = Math.min(1, state.trauma + 0.45);
    let dealt = amount;
    if (!p.onFoot && state.playerCar) {
      dealt = armorSoak(state.playerCar, amount);
      state.playerCar.health -= dealt;
      burst(p.x, p.y, '#ff9800', 10, 160);
      if (state.playerCar.health <= 0) {
        burst(p.x, p.y, '#ff5722', 26, 320);
        burst(p.x, p.y, '#616161', 18, 120);
        state.over = true;
        return EVENT_OVER;
      }
      return EVENT_HIT;
    }
    p.health -= dealt;
    burst(p.x, p.y, '#ff5252', 8, 140);
    if (p.health <= 0) {
      state.over = true;
      return EVENT_OVER;
    }
    return EVENT_HIT;
  }

  function addWanted(n) {
    const p = state.player;
    const before = p.wanted;
    p.wantedFloat = clamp(p.wantedFloat + n, 0, 5);
    p.wanted = Math.floor(p.wantedFloat);
    if (p.wanted > before) {
      p.wantedPop = 1;
      state.feed = `APD DISPATCH: pursuit in ${DISTRICTS[districtIndexAt(p.x, p.y)].name} — ${p.wanted} star${p.wanted > 1 ? 's' : ''} out.`;
      return EVENT_WANTED;
    }
    return 0;
  }

  function setWanted(n) {
    const p = state.player;
    const before = p.wanted;
    p.wantedFloat = clamp(n, 0, 5);
    p.wanted = Math.floor(p.wantedFloat);
    p.hiddenTimer = 0;
    if (p.wanted > before) {
      p.wantedPop = 1;
      state.feed = `APD DISPATCH: pursuit in ${DISTRICTS[districtIndexAt(p.x, p.y)].name} — ${p.wanted} star${p.wanted > 1 ? 's' : ''} out.`;
    }
  }

  function collectCash(pickup) {
    const p = state.player;
    const value = pickup.value * p.combo;
    p.cash += value;
    p.cashPop = 1;
    p.combo = Math.min(COMBO.max, p.combo + 1);
    p.comboTimer = COMBO.window;
    p.respect = Math.min(RESPECT_MAX, p.respect + 10);
    state.stats.pickups += 1;
    state.mission.collected += 1;
    state.feed = `APD DISPATCH: cash grab reported in ${DISTRICTS[districtIndexAt(pickup.x, pickup.y)].name}.`;
    burst(pickup.x, pickup.y, '#66bb6a', 8, 120);
    pickup.active = false;
    return EVENT_PICKUP;
  }

  function fireWeapon(input) {
    const p = state.player;
    if (p.fireCd > 0) return 0;
    const w = WEAPONS[p.weapon];
    if (!w.ammo) {
      // Fists: a short swing in the facing/aim direction.
      p.fireCd = w.rate;
      state.stats.shots += 1;
      const ax = input.aimX !== undefined ? input.aimX : p.x + Math.cos(p.angle) * 40;
      const ay = input.aimY !== undefined ? input.aimY : p.y + Math.sin(p.angle) * 40;
      const ang = angleTo(p.x, p.y, ax, ay);
      for (const c of state.police) {
        if (circleHit(p.x, p.y, w.range, c.x, c.y, 30) && Math.abs(angleDiff(ang, angleTo(p.x, p.y, c.x, c.y))) < 1.2) {
          c.health -= w.damage;
          state.stats.hits += 1;
          return addWanted(1) | EVENT_HIT;
        }
      }
      return 0;
    }
    const ammoKey = w.ammo;
    if (p[ammoKey] <= 0) return EVENT_EMPTY;
    p[ammoKey] -= 1;
    p.fireCd = w.rate;
    state.stats.shots += 1;
    const ax = input.aimX !== undefined ? input.aimX : p.x + Math.cos(p.angle) * 200;
    const ay = input.aimY !== undefined ? input.aimY : p.y + Math.sin(p.angle) * 200;
    const ang = angleTo(p.x, p.y, ax, ay) + (rng.next() - 0.5) * w.spread * 2;
    let b = null;
    for (const bullet of state.bullets) {
      if (!bullet.active) { b = bullet; break; }
    }
    if (!b) {
      b = createBullet(p.x, p.y, ang, 'player');
      state.bullets.push(b);
    } else {
      b.active = true; b.x = p.x; b.y = p.y; b.angle = ang; b.from = 'player'; b.life = 1.2;
    }
    spawnParticle(p.x + Math.cos(ang) * 26, p.y + Math.sin(ang) * 26, 0, 0, 0.08, 5, '#ffee58');
    return 0;
  }

  function garageBuy(type) {
    const p = state.player;
    const spec = VEHICLE_TYPES[type];
    if (!spec || state.save.owned.includes(type)) return false;
    if (p.cash < spec.price) return false;
    p.cash -= spec.price;
    state.save.owned.push(type);
    state.save.upgrades[type] = { speed: 0, handling: 0, armor: 0 };
    const car = createVehicle(type, GARAGE.x + 40, GARAGE.y + 120, 0);
    car.parked = true;
    car.owned = true;
    state.cars.push(car);
    state.feed = `GARAGE: ${spec.display} bought — ready to roll.`;
    return true;
  }

  function garageRepair() {
    const p = state.player;
    const car = state.playerCar;
    if (!car || car.health >= 100) return false;
    const missing = 100 - car.health;
    const cost = Math.ceil(missing * REPAIR_CASH_PER_HP);
    if (p.cash < cost) return false;
    p.cash -= cost;
    car.health = 100;
    return true;
  }

  function garageUpgrade(type, kind) {
    const p = state.player;
    const up = state.save.upgrades[type];
    if (!up || !(kind in up) || up[kind] >= 3) return false;
    // Rank gates: level 2 needs FIXER, level 3 needs SHOT CALLER.
    const newLevel = up[kind] + 1;
    const rank = rankFor(p.respect);
    if (newLevel >= 3 && rank < 2) return false;
    if (newLevel >= 2 && rank < 1) return false;
    const cost = UPGRADE_COSTS[up[kind]];
    if (p.cash < cost) return false;
    p.cash -= cost;
    up[kind] += 1;
    for (const car of state.cars) if (car.type === type) car.upgrades = { ...up };
    if (state.playerCar && state.playerCar.type === type) state.playerCar.upgrades = { ...up };
    return true;
  }

  function cycleRadio() {
    const p = state.player;
    p.radio = (p.radio + 1) % 3;
    return p.radio;
  }

  function selectWeapon(index) {
    if (index < 0 || index >= WEAPONS.length) return false;
    if (!state.save.weapons.includes(WEAPONS[index].name)) return false;
    state.player.weapon = index;
    return true;
  }

  /** Buy a weapon tier: needs its rank, its price, and not already owned. */
  function buyWeapon(name) {
    const p = state.player;
    const w = WEAPONS.find((x) => x.name === name);
    if (!w) return false;
    if (state.save.weapons.includes(name)) return false;
    if (rankFor(p.respect) < w.rank) return false;
    if (p.cash < w.price) return false;
    p.cash -= w.price;
    state.save.weapons.push(name);
    if (w.ammo) p[w.ammo] = Math.min(w.ammoMax, (p[w.ammo] || 0) + Math.ceil(w.ammoMax / 2));
    return true;
  }

  /**
   * Use a crew ability (index into CREW_ORDER). Returns false when on cooldown
   * or when it would do nothing (already clean / already repaired).
   */
  function useCrew(index) {
    const p = state.player;
    const member = CREW[index];
    if (!member) return false;
    if (state.crew[member.id] > 0) return false;
    if (member.id === 'driver') {
      if (p.wanted <= 0) return false;
      p.wantedFloat = Math.max(0, p.wantedFloat - 2);
      p.wanted = Math.floor(p.wantedFloat);
      state.feed = `APD DISPATCH: plates swapped — ${DISTRICTS[districtIndexAt(p.x, p.y)].name} pursuit cooling off.`;
    } else if (member.id === 'mechanic') {
      const car = state.playerCar;
      if (car && car.health >= 100) return false;
      if (!car && p.health >= 100) return false;
      if (car) car.health = 100;
      else p.health = 100;
      state.feed = `SINTA: field fix done — ${car ? 'car' : 'you'} are back to full.`;
    } else if (member.id === 'lookout') {
      state.crew.lookoutUntil = state.elapsed + 20;
      state.feed = `BIMO: eyes out — police and cash marked on the minimap for 20s.`;
    }
    state.crew[member.id] = member.cooldown;
    return true;
  }

  // ---------------------------------------------------------- save

  function serializeSave() {
    const p = state.player;
    const best = Math.max(state.save.bestCash, p.cash);
    return {
      bestCash: best,
      bestScore: Math.max(state.save.bestScore, p.cash),
      chapter: Math.max(state.save.chapter, state.mission.chapter),
      owned: [...state.save.owned],
      upgrades: JSON.parse(JSON.stringify(state.save.upgrades)),
      weapons: [...state.save.weapons],
    };
  }

  function applySave(data) {
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data.owned)) state.save.owned = data.owned.filter((t) => VEHICLE_TYPES[t]);
    if (data.upgrades && typeof data.upgrades === 'object') {
      for (const t of Object.keys(data.upgrades)) {
        if (VEHICLE_TYPES[t]) state.save.upgrades[t] = data.upgrades[t];
      }
    }
    if (Array.isArray(data.weapons)) {
      state.save.weapons = data.weapons.filter((n) => WEAPONS.some((w) => w.name === n));
      if (state.save.weapons.length === 0) state.save.weapons = ['Fists', '.38', 'SMG'];
    }
    if (typeof data.bestCash === 'number') state.save.bestCash = data.bestCash;
    if (typeof data.bestScore === 'number') state.save.bestScore = data.bestScore;
    if (typeof data.chapter === 'number') state.save.chapter = data.chapter;
    return true;
  }

  // ---------------------------------------------------------- step

  function stepPlayer(dt, input, harmless) {
    const p = state.player;
    if (p.fireCd > 0) p.fireCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.comboTimer > 0) {
      p.comboTimer -= dt;
      if (p.comboTimer <= 0) p.combo = 1;
    }
    if (p.cashPop > 0) p.cashPop = Math.max(0, p.cashPop - dt * 2);
    if (p.wantedPop > 0) p.wantedPop = Math.max(0, p.wantedPop - dt * 2);
    let events = 0;

    if (input.weapon !== null && input.weapon !== undefined) selectWeapon(input.weapon);
    if (input.crew !== null && input.crew !== undefined) useCrew(input.crew);
    if (input.radio) cycleRadio();

    if (p.onFoot) {
      const mx = input.mx || 0;
      const my = input.my || 0;
      const len = Math.hypot(mx, my);
      if (len > 0) {
        p.angle = Math.atan2(my, mx);
        p.x += (mx / len) * PLAYER.walkSpeed * dt;
        p.y += (my / len) * PLAYER.walkSpeed * dt;
      }
      p.x = clamp(p.x, 20, WORLD.width - 20);
      p.y = clamp(p.y, 20, WATER_Y - 16);
      const hit = resolveBuildings(p.x, p.y, PLAYER.radius);
      p.x = hit.x; p.y = hit.y;
      if (input.enter && !harmless) {
        const dx = p.x - GARAGE.x;
        const dy = p.y - GARAGE.y;
        if (dx * dx + dy * dy < GARAGE.radius * GARAGE.radius) {
          state.garageOpen = true;
        } else {
          for (let i = 0; i < state.cars.length; i += 1) {
            const car = state.cars[i];
            if (!car.parked) continue;
            if (dist2(p.x, p.y, car.x, car.y) < PLAYER.enterDist * PLAYER.enterDist) {
              state.cars.splice(i, 1);
              car.parked = false;
              if (state.save.upgrades[car.type]) car.upgrades = { ...state.save.upgrades[car.type] };
              state.playerCar = car;
              p.onFoot = false;
              p.x = car.x; p.y = car.y; p.angle = car.angle;
              break;
            }
          }
        }
      }
      if (input.fire && !harmless) events |= fireWeapon(input);
      return events;
    }

    // Driving.
    const car = state.playerCar;
    if (!car) { p.onFoot = true; return events; }
    const top = carTopSpeed(car);
    if (input.accel) car.speed += car.accel * dt;
    if (input.brake) car.speed -= (car.speed > 0 ? car.accel * 1.4 : car.accel * 0.7) * dt;
    car.speed -= car.speed * 0.55 * dt;
    if (input.handbrake) car.speed -= Math.sign(car.speed) * 500 * dt;
    car.speed = clamp(car.speed, -car.accel * 0.45, top);
    const steer = input.steer || 0;
    const grip = carGrip(car) * (input.handbrake ? 1.7 : 1);
    car.angle += steer * grip * clamp(Math.abs(car.speed) / 220, 0, 1.4) * dt * Math.sign(car.speed || 1);
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    car.x = clamp(nx, 30, WORLD.width - 30);
    car.y = clamp(ny, 30, WATER_Y - 20);
    const hit = resolveBuildings(car.x, car.y, car.w / 2);
    if (hit.hit && Math.abs(car.speed) > 120 && !harmless) {
      events |= damagePlayer(Math.abs(car.speed) * 0.06, car.x, car.y);
      car.speed *= 0.4;
    }
    car.x = hit.x; car.y = hit.y;
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    if (input.handbrake && Math.abs(car.speed) > 200) {
      spawnSkid(car.x - Math.cos(car.angle) * car.w / 2, car.y - Math.sin(car.angle) * car.w / 2, car.angle);
      spawnParticle(car.x, car.y, -Math.cos(car.angle) * 40, -Math.sin(car.angle) * 40, 0.5, 4, '#bdbdbd');
      if (p.comboTimer <= 0) { p.combo = Math.min(COMBO.max, p.combo + 1); state.stats.drifts += 1; }
      p.comboTimer = COMBO.window;
    }
    if (Math.abs(car.speed) > 40 && rng.next() < 0.3) {
      spawnParticle(car.x - Math.cos(car.angle) * car.w / 2, car.y - Math.sin(car.angle) * car.w / 2, 0, 0, 0.4, 3, '#9e9e9e');
    }
    if (input.enter && !harmless) {
      car.speed = 0;
      car.parked = true;
      car.x = p.x; car.y = p.y; car.angle = p.angle;
      state.cars.push(car);
      state.playerCar = null;
      p.onFoot = true;
      p.x += Math.cos(p.angle + Math.PI / 2) * 40;
      p.y += Math.sin(p.angle + Math.PI / 2) * 40;
    }
    if (input.repair && !harmless && Math.abs(car.speed) < 30) garageRepair();
    if (input.fire && !harmless) events |= fireWeapon(input);
    return events;
  }

  function stepTraffic(dt) {
    for (const car of state.cars) {
      if (car.parked) continue;
      const wp = car.wp;
      if (!wp) continue;
      const ang = angleTo(car.x, car.y, wp.x, wp.y);
      car.angle += angleDiff(car.angle, ang) * Math.min(1, 3 * dt);
      let slow = false;
      for (const other of state.cars) {
        if (other === car || other.parked) continue;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const ahead = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
        if (ahead > 0 && ahead < 90 && Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle)) < 40) { slow = true; break; }
      }
      const target = slow ? car.topSpeed * 0.25 : car.topSpeed;
      car.speed = lerp(car.speed, target, Math.min(1, dt));
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      car.x = clamp(car.x, 30, WORLD.width - 30);
      car.y = clamp(car.y, 30, WATER_Y - 20);
      const hit = resolveBuildings(car.x, car.y, car.w / 2);
      car.x = hit.x; car.y = hit.y;
      if (dist2(car.x, car.y, wp.x, wp.y) < 60 * 60) {
        const options = [];
        for (const rx of ROADS_V) for (const ry of ROADS_H) {
          if ((rx === wp.x || ry === wp.y) && !(rx === wp.x && ry === wp.y)) options.push({ x: rx, y: ry });
        }
        car.wp = options.length > 0 ? options[Math.floor(rng.next() * options.length)] : nearestRoadPoint(car.x, car.y);
      }
    }
  }

  function stepPeds(dt, harmless) {
    const p = state.player;
    for (const ped of state.peds) {
      if (ped.inTaxi) {
        ped.x = p.x;
        ped.y = p.y;
        continue;
      }
      if (ped.wait > 0) {
        ped.wait -= dt;
        if (ped.wait <= 0) {
          ped.tx = clamp(ped.x + rng.range(-260, 260), 40, WORLD.width - 40);
          ped.ty = clamp(ped.y + rng.range(-200, 200), 40, WATER_Y - 40);
        }
        continue;
      }
      // Flee a fast car bearing down on the sidewalk.
      const car = state.playerCar;
      const danger = !p.onFoot && car && Math.abs(car.speed) > 150 && dist2(ped.x, ped.y, p.x, p.y) < 120 * 120;
      let tx = ped.tx;
      let ty = ped.ty;
      let speed = 62;
      if (danger) {
        const away = angleTo(p.x, p.y, ped.x, ped.y);
        tx = ped.x + Math.cos(away) * 200;
        ty = ped.y + Math.sin(away) * 200;
        speed = 150;
        ped.flee = 1;
      }
      const d = Math.hypot(tx - ped.x, ty - ped.y);
      if (d < 12) {
        ped.wait = rng.range(1, 4);
      } else {
        ped.angle = Math.atan2(ty - ped.y, tx - ped.x);
        ped.x += (Math.cos(ped.angle) * speed * dt);
        ped.y += (Math.sin(ped.angle) * speed * dt);
        ped.walkPhase += dt * 8;
      }
      ped.x = clamp(ped.x, 20, WORLD.width - 20);
      ped.y = clamp(ped.y, 20, WATER_Y - 16);
      // A fast car hitting a pedestrian is a crime, not a bump.
      if (!harmless && car && Math.abs(car.speed) > 60 && circleHit(ped.x, ped.y, 14, p.x, p.y, 30)) {
        ped.wait = 3;
        ped.x += Math.cos(ped.angle) * 30;
        ped.y += Math.sin(ped.angle) * 30;
        addWanted(1);
      }
    }
  }

  function stepPolice(dt, harmless) {
    const p = state.player;
    const desired = p.wanted > 0 ? Math.min(2 + p.wanted, POLICE.maxCruisers) : POLICE.patrolCount;
    let tries = 0;
    while (state.police.length < desired && tries < 8) {
      tries += 1;
      const at = roadPoint();
      const far = dist2(at.x, at.y, p.x, p.y) > 500 * 500;
      if (!far && state.police.length > 0) continue;
      state.police.push(createPolice(at.x, at.y));
      break;
    }
    while (state.police.length > desired) {
      let worst = 0;
      let wd = -1;
      for (let i = 0; i < state.police.length; i += 1) {
        const d = dist2(state.police[i].x, state.police[i].y, p.x, p.y);
        if (d > wd) { wd = d; worst = i; }
      }
      state.police.splice(worst, 1);
    }

    let anyVisible = false;
    for (const c of state.police) {
      const d2 = dist2(c.x, c.y, p.x, p.y);
      const visible = d2 < POLICE.viewDist * POLICE.viewDist;
      if (visible) anyVisible = true;
      if (p.wanted > 0 && !harmless) {
        c.mode = visible || p.wanted >= 3 ? 'chase' : 'search';
        if (visible) { c.knownX = p.x; c.knownY = p.y; }
      } else {
        c.mode = 'patrol';
      }
      let tx = c.knownX;
      let ty = c.knownY;
      let speed = 200;
      if (c.mode === 'chase') {
        const pvx = p.onFoot ? 0 : Math.cos(p.angle) * (state.playerCar ? state.playerCar.speed : 0);
        const pvy = p.onFoot ? 0 : Math.sin(p.angle) * (state.playerCar ? state.playerCar.speed : 0);
        tx = p.x + pvx * 0.45;
        ty = p.y + pvy * 0.45;
        speed = POLICE.chaseSpeed;
      } else if (c.mode === 'patrol') {
        if (!c.wp || dist2(c.x, c.y, c.wp.x, c.wp.y) < 60 * 60) c.wp = nearestRoadPoint(c.x + (rng.next() - 0.5) * 800, c.y + (rng.next() - 0.5) * 800);
        tx = c.wp.x; ty = c.wp.y;
        speed = 200;
      }
      const ang = angleTo(c.x, c.y, tx, ty);
      c.angle += angleDiff(c.angle, ang) * Math.min(1, 2.6 * dt);
      c.speed = lerp(c.speed, speed, Math.min(1, 1.5 * dt));
      c.x += Math.cos(c.angle) * c.speed * dt;
      c.y += Math.sin(c.angle) * c.speed * dt;
      c.x = clamp(c.x, 30, WORLD.width - 30);
      c.y = clamp(c.y, 30, WATER_Y - 20);
      const hit = resolveBuildings(c.x, c.y, c.w / 2);
      c.x = hit.x; c.y = hit.y;
      // Ramming the player.
      if (!harmless && !state.over && circleHit(c.x, c.y, 34, p.x, p.y, p.onFoot ? 16 : 34)) {
        const playerSpeed = state.playerCar ? Math.abs(state.playerCar.speed) : 0;
        if (playerSpeed < 30) {
          c.bustTimer += dt;
          if (c.bustTimer > (p.onFoot ? POLICE.bustTimeFoot : POLICE.bustTime)) {
            state.busted = true;
            state.over = true;
            return EVENT_BUSTED | EVENT_OVER;
          }
        } else {
          c.bustTimer = 0;
          // A ram only bites while the player is not invulnerable: without this
          // gate, six cruisers overlapping in one step would multiply the speed
          // cut (0.6^6) and pin the car no matter how fast it was going.
          if (playerSpeed > 120 && p.invuln <= 0) {
            c.health -= 8;
            c.speed *= 0.5;
            if (state.playerCar) state.playerCar.speed *= 0.6;
            damagePlayer(POLICE.ramDamage, c.x, c.y);
          }
        }
      } else {
        c.bustTimer = Math.max(0, c.bustTimer - dt);
      }
      // A destroyed cruiser explodes and leaves.
      if (c.health <= 0) {
        burst(c.x, c.y, '#ff5722', 22, 300);
        burst(c.x, c.y, '#616161', 14, 110);
        c.health = -999;
      }
    }
    for (let i = state.police.length - 1; i >= 0; i -= 1) {
      if (state.police[i].health <= -999) state.police.splice(i, 1);
    }
    // Wanted decays only while no cruiser can see the player — but only after a
    // 3-second grace, so a fresh chase does not fizzle while the cruisers are
    // still driving in from their (deliberately off-screen) spawn points.
    if (p.wanted > 0 && !anyVisible && !harmless) {
      p.hiddenTimer += dt;
      if (p.hiddenTimer > 3) {
        p.wantedFloat = Math.max(0, p.wantedFloat - POLICE.decayPerSec * dt);
        p.wanted = Math.floor(p.wantedFloat);
      }
    } else {
      p.hiddenTimer = 0;
    }
    return 0;
  }

  function stepHeli(dt) {
    const p = state.player;
    if (p.wanted >= 5) {
      if (!state.heli) state.heli = createHelicopter(p.x, p.y - 200);
      const h = state.heli;
      h.bob += dt;
      // Hover just above and beside the player, converging fast so it never lags
      // hundreds of pixels behind a moving car (its body is drawn 70px above
      // this ground point, so it stays inside the frame).
      const tx = p.x + 30;
      const ty = p.y - 30;
      h.x = lerp(h.x, tx, Math.min(1, 2.0 * dt));
      h.y = lerp(h.y, ty, Math.min(1, 2.0 * dt));
      h.angle = angleTo(h.x, h.y, p.x, p.y);
      h.lightAngle = h.angle;
    } else if (state.heli) {
      state.heli = null;
    }
  }

  function stepRoadblocks(dt) {
    const p = state.player;
    if (p.wanted >= POLICE.roadblockAt && state.roadblocks.length === 0) {
      const ahead = 320;
      const bx = clamp(p.x + Math.cos(p.angle) * ahead, 100, WORLD.width - 100);
      const by = clamp(p.y + Math.sin(p.angle) * ahead, 100, WATER_Y - 100);
      state.roadblocks.push(createRoadblock(bx, by, p.angle + Math.PI / 2));
      for (let i = 0; i < 2; i += 1) {
        const c = createPolice(bx + (i === 0 ? -70 : 70), by);
        c.mode = 'block';
        c.speed = 0;
        state.police.push(c);
      }
    }
    for (let i = state.roadblocks.length - 1; i >= 0; i -= 1) {
      const rb = state.roadblocks[i];
      rb.life -= dt;
      const d2 = dist2(rb.x, rb.y, p.x, p.y);
      if (p.wanted < POLICE.roadblockAt || rb.life <= 0 || d2 < 60 * 60) {
        state.roadblocks.splice(i, 1);
      }
    }
  }

  function stepBullets(dt) {
    let events = 0;
    for (const b of state.bullets) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; continue; }
      const w = WEAPONS[state.player.weapon];
      b.x += Math.cos(b.angle) * (w.bulletSpeed || 900) * dt;
      b.y += Math.sin(b.angle) * (w.bulletSpeed || 900) * dt;
      if (b.x < 0 || b.x > WORLD.width || b.y < 0 || b.y > WATER_Y) { b.active = false; continue; }
      for (const c of state.police) {
        if (circleHit(b.x, b.y, 4, c.x, c.y, 30)) {
          c.health -= w.damage;
          state.stats.hits += 1;
          burst(b.x, b.y, '#ffee58', 6, 120);
          b.active = false;
          events |= addWanted(1) | EVENT_HIT;
          break;
        }
      }
      if (!b.active) continue;
      for (const car of state.cars) {
        if (car.parked) continue;
        if (circleHit(b.x, b.y, 4, car.x, car.y, 30)) {
          car.health -= w.damage;
          state.stats.hits += 1;
          burst(b.x, b.y, '#ffee58', 6, 120);
          b.active = false;
          events |= addWanted(1) | EVENT_HIT;
          break;
        }
      }
      if (!b.active) continue;
      for (const ped of state.peds) {
        if (ped.inTaxi) continue;
        if (circleHit(b.x, b.y, 4, ped.x, ped.y, 14)) {
          ped.wait = 3;
          state.stats.hits += 1;
          burst(b.x, b.y, '#ff5252', 6, 120);
          b.active = false;
          events |= addWanted(1) | EVENT_HIT;
          break;
        }
      }
    }
    return events;
  }

  function stepPickups(dt) {
    let events = 0;
    const p = state.player;
    const radius = p.onFoot ? 42 : 58;
    for (const pk of state.pickups) {
      if (!pk.active) continue;
      pk.bob += dt;
      if (dist2(p.x, p.y, pk.x, pk.y) < radius * radius) {
        if (pk.kind === 'cash') events |= collectCash(pk);
        else {
          p.ammoPistol = Math.min(WEAPONS[1].ammoMax, p.ammoPistol + 12);
          p.ammoSmg = Math.min(WEAPONS[2].ammoMax, p.ammoSmg + 30);
          p.ammoShotgun = Math.min(WEAPONS[3].ammoMax, p.ammoShotgun + 6);
          p.ammoAr = Math.min(WEAPONS[4].ammoMax, p.ammoAr + 30);
          burst(pk.x, pk.y, '#42a5f5', 8, 120);
          pk.active = false;
          events |= EVENT_PICKUP;
        }
      }
    }
    return events;
  }

  function stepParticles(dt) {
    for (const pt of state.particles) {
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) { pt.active = false; continue; }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= pt.drag;
      pt.vy *= pt.drag;
    }
    for (const s of state.skids) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) s.active = false;
    }
    if (state.trauma > 0) state.trauma = Math.max(0, state.trauma - dt * 1.6);
    if (state.damageFlash > 0) state.damageFlash = Math.max(0, state.damageFlash - dt * 1.8);
  }

  function stepCollisions(dt, harmless) {
    let events = 0;
    const p = state.player;
    if (p.onFoot || !state.playerCar || harmless || state.over) return 0;
    const car = state.playerCar;
    for (const other of state.cars) {
      if (other.parked) continue;
      if (circleHit(car.x, car.y, 34, other.x, other.y, 34)) {
        const rel = Math.abs(car.speed - other.speed);
        if (rel > 140) {
          events |= damagePlayer(rel * 0.05, other.x, other.y);
          other.speed *= 0.5;
          car.speed *= 0.6;
          // Near-miss is the opposite: close, fast, no touch.
        }
      } else if (Math.abs(car.speed) > 300 && !other.nearMissed) {
        const d = Math.hypot(other.x - car.x, other.y - car.y);
        if (d < 34 + COMBO.nearMissDist && d > 34) {
          other.nearMissed = true;
          p.cash += COMBO.nearMissCash * p.combo;
          p.combo = Math.min(COMBO.max, p.combo + 1);
          p.comboTimer = COMBO.window;
          p.cashPop = 1;
          state.stats.nearMisses += 1;
        }
      }
      if (Math.hypot(other.x - car.x, other.y - car.y) > 300) other.nearMissed = false;
    }
    return events;
  }

  // One shared handle for the mission module: no per-step allocation.
  const api = { state, rng, spawnCashNear, nearestPed, setWanted };

  // ---------------------------------------------------------- the step

  function step(dt, input, harmless) {
    let events = 0;
    if (state.paused) return 0;
    if (state.over) return 0;
    state.elapsed += dt;
    state.timeOfDay = (state.timeOfDay + dt / 240) % 1;
    input = input || blankInput();
    events |= stepPlayer(dt, input, harmless);
    if (state.over) return events | EVENT_OVER;
    // Crew cooldowns tick down (scalar, no allocation in the hot loop).
    for (const id of CREW_ORDER) {
      if (state.crew[id] > 0) state.crew[id] = Math.max(0, state.crew[id] - dt);
    }
    stepTraffic(dt);
    stepPeds(dt, harmless);
    const policeEvents = stepPolice(dt, harmless);
    events |= policeEvents;
    if (state.over) return events | EVENT_OVER;
    stepHeli(dt);
    stepRoadblocks(dt);
    events |= stepBullets(dt);
    events |= stepPickups(dt);
    events |= stepCollisions(dt, harmless);
    stepParticles(dt);
    if (!harmless) {
      const m = updateMissions(api, dt);
      if (m.chapterDone) {
        events |= EVENT_CHAPTER;
        state.stats.chapters += 1;
        if (m.victory) {
          state.victory = true;
          state.over = true;
          events |= EVENT_OVER;
        }
      }
      const s = updateSideMission(api, dt);
      if (s.sideDone) events |= EVENT_SIDE;
      // Walking into a side-mission marker starts it.
      if (!state.side.active && state.side.marker) {
        const mk = state.side.marker;
        if (dist2(state.player.x, state.player.y, mk.x, mk.y) < 70 * 70) {
          startSideMission(api, mk.type);
        }
      }
    }
    return events;
  }

  reset();
  return {
    state, reset, step,
    spawnCashNear, spawnAmmoNear, nearestPed, setWanted,
    garageBuy, garageRepair, garageUpgrade, cycleRadio, selectWeapon,
    buyWeapon, useCrew, startChapterAt: (i) => startChapter(api, i),
    serializeSave, applySave, blankInput,
  };
}
