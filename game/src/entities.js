// Entity factories and geometry helpers, pure logic (no drawing, no browser):
// vehicles, pedestrians, police cruisers, pickups, bullets, the helicopter and
// roadblocks. The world owns the arrays; these helpers build and move the items.

import { POLICE, VEHICLE_TYPES } from './config.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
/** Shortest signed turn from angle a toward angle b, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
export function circleHit(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}

/** A vehicle of `type` (a key of VEHICLE_TYPES) with its tuning applied. */
export function createVehicle(type, x, y, angle) {
  const spec = VEHICLE_TYPES[type];
  return {
    kind: 'car',
    type,
    x, y, angle,
    speed: 0,
    health: 100,
    w: spec.w,
    h: spec.h,
    topSpeed: spec.topSpeed,
    accel: spec.accel,
    grip: spec.grip,
    color: spec.color,
    color2: spec.color2,
    drift: 0,
    smoke: 0,
    upgrades: { speed: 0, handling: 0, armor: 0 },
    owned: false,
    parked: false,
    // traffic/pedestrian AI scratch, reused (never allocated in the hot loop)
    wp: 0,
    wait: 0,
    vx: 0,
    vy: 0,
  };
}

/** Effective top speed of a car with its garage upgrades applied. */
export function carTopSpeed(car) {
  return car.topSpeed * (1 + 0.12 * car.upgrades.speed);
}
/** Effective steering grip of a car with its garage upgrades applied. */
export function carGrip(car) {
  return car.grip * (1 + 0.15 * car.upgrades.handling);
}
/** Damage a car takes after armor upgrades: each armor level soaks 15%. */
export function armorSoak(car, damage) {
  return damage * (1 - 0.15 * car.upgrades.armor);
}

export function createPedestrian(x, y, color) {
  return {
    kind: 'ped',
    x, y,
    angle: 0,
    speed: 0,
    color,
    walkPhase: Math.random() * Math.PI * 2,
    // AI scratch
    tx: x, ty: y, wait: 0, flee: 0,
    inTaxi: false,
  };
}

export function createPolice(x, y) {
  const car = createVehicle('cruiser', x, y, 0);
  car.kind = 'police';
  car.mode = 'patrol'; // patrol | chase | search | block
  car.knownX = x;
  car.knownY = y;
  car.bustTimer = 0;
  car.topSpeed = POLICE.chaseSpeed;
  return car;
}

export function createHelicopter(x, y) {
  return { kind: 'heli', x, y, angle: 0, bob: 0, lightAngle: 0 };
}

export function createRoadblock(x, y, angle) {
  return { kind: 'roadblock', x, y, angle, life: 30 };
}

export function createCashPickup(x, y, value) {
  return { kind: 'cash', x, y, value, bob: 0, active: true };
}

export function createAmmoPickup(x, y) {
  return { kind: 'ammo', x, y, bob: 0, active: true };
}

export function createBullet(x, y, angle, from) {
  return { kind: 'bullet', x, y, angle, from, life: 1.2, active: true };
}

/** A particle pool entry, allocated once and reused (see world.js). */
export function createParticle() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, color: '#fff', drag: 1 };
}

/** A fading skid mark, allocated once and reused. */
export function createSkid() {
  return { active: false, x: 0, y: 0, angle: 0, life: 0 };
}
