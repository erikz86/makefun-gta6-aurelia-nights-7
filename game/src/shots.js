// Screenshot staging: the same seed always stages the same scene (fixed 1/60s tick, pure autopilot). stageShot mutates the world in place and reports the screen + best cash for the HUD.

import { GARAGE, STEP } from './config.js';
import { angleDiff, angleTo } from './entities.js';
import { blankInput } from './world.js';

/** A driver that follows `waypoints` in order, advancing when one is reached. */
export function createRouteDriver(waypoints) {
  let wp = 0;
  return function drive(state) {
    const input = blankInput();
    const p = state.player;
    if (p.onFoot || !state.playerCar) return input;
    const last = () => wp >= waypoints.length - 1;
    let target = waypoints[Math.min(wp, waypoints.length - 1)];
    let dx = target.x - p.x;
    let dy = target.y - p.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 120 && !last()) {
      wp += 1;
      target = waypoints[wp];
      dx = target.x - p.x;
      dy = target.y - p.y;
      dist = Math.hypot(dx, dy);
    }
    const diff = angleDiff(p.angle, angleTo(p.x, p.y, target.x, target.y));
    const speed = Math.abs(state.playerCar.speed);
    input.steer = diff > 0.08 ? 1 : diff < -0.08 ? -1 : 0;
    const needSlow = (!last() && dist < 300) || Math.abs(diff) > 0.9;
    if (needSlow && speed > 170) input.brake = true;
    else input.accel = true;
    return input;
  };
}

function runSteps(world, steps, inputFn) {
  for (let i = 0; i < steps; i += 1) {
    const input = inputFn ? inputFn(world.state) : blankInput();
    world.step(STEP, input);
  }
}

/** Enter the starter sedan the way a player does: walk up to it and press E. */
function enterStarterCar(world) {
  const s = world.state;
  const car = s.cars.find((c) => c.parked);
  if (!car) return;
  s.player.x = car.x + 10;
  s.player.y = car.y;
  const inp = blankInput();
  inp.enter = true;
  world.step(STEP, inp);
}

const HARBOUR_RUN = [{ x: 400, y: 1650 }];

function clusterPeds(world, x, y, radius, n, s) {
  const rng = world.state.rng;
  for (let i = s || 0; i < (s || 0) + n && i < world.state.peds.length; i += 1) {
    const ped = world.state.peds[i];
    ped.x = x + rng.range(-radius, radius);
    ped.y = y + rng.range(-radius, radius);
    ped.tx = ped.x;
    ped.ty = ped.y;
    ped.wait = 999;
  }
}

function burnCarAt(world, x, y, angle) {
  const car = world.state.cars.find((c) => !c.parked && c.kind === 'car');
  if (!car) return;
  car.parked = true;
  car.health = 12;
  car.speed = 0;
  car.x = x;
  car.y = y;
  car.angle = angle || 0;
}

function parkCarAt(w, x, y, a) { const c = w.state.cars.find((c) => !c.parked && c.kind === 'car'); if (!c) return; c.parked = true; c.speed = 0; c.x = x; c.y = y; c.angle = a || 0; }

/** Wreck + crowd ahead of the player (forward/lateral). */
function stageWreckAhead(world, angle) {
  const s = world.state;
  const car = s.playerCar;
  const px = car ? car.x : s.player.x;
  const py = car ? car.y : s.player.y;
  const a = angle !== undefined ? angle : (car ? car.angle : s.player.angle);
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const rx = -fy;
  const ry = fx;
  burnCarAt(world, px + fx * 380 + rx * 60, py + fy * 380 + ry * 60, a + 0.4);
  clusterPeds(world, px + fx * 420 - rx * 40, py + fy * 420 - ry * 40, 180, 14);
}

export function stageShot(name, world) {
  const state = world.state;
  if (name === 'start') {
    runSteps(world, 300, () => blankInput());
    return { screen: 'title', best: 0 };
  }
  if (name === 'play') {
    world.startChapterAt(1);
    state.player.cash = 850;
    state.player.respect = 180;
    enterStarterCar(world);
    runSteps(world, 240, createRouteDriver([...HARBOUR_RUN, { x: 1750, y: 1650 }]));
    state.mission.intro = 0;
    return { screen: 'play', best: 850 };
  }
  if (name === 'chase') {
    world.startChapterAt(5);
    state.player.cash = 12480;
    state.player.respect = 320;
    state.districtStanding[3] = 52; // HARBOR NEUTRAL
    enterStarterCar(world);
    if (world.state.playerCar) world.state.playerCar.health = 400;
    world.setWanted(5);
    runSteps(world, 300, createRouteDriver([...HARBOUR_RUN, { x: 1900, y: 1650 }]));
    stageWreckAhead(world, 0);
    const pc = world.state.playerCar, px = pc ? pc.x : world.state.player.x, py = pc ? pc.y : world.state.player.y;
    parkCarAt(world, px + 260, py - 130, 0.15);
    parkCarAt(world, px + 560, py + 140, -0.15);
    clusterPeds(world, px + 180, py - 140, 90, 8, 14);
    world.setWanted(5);
    runSteps(world, 10, createRouteDriver([{ x: 1900, y: 1650 }]));
    state.timeOfDay = 0.62; // sunset dusk, golden-hour tint
    state.mission.intro = 0;
    return { screen: 'play', best: 12480 };
  }
  if (name === 'onfoot') {
    world.startChapterAt(1);
    state.player.cash = 2150;
    state.player.respect = 180;
    state.mission.collected = 2;
    state.player.x = 1600;
    state.player.y = 1970;
    state.player.onFoot = true;
    clusterPeds(world, 1600, 1970, 180, 20);
    world.setWanted(2);
    runSteps(world, 120, () => blankInput());
    state.timeOfDay = 0.55;
    state.mission.intro = 0;
    return { screen: 'play', best: 2150, camYaw: -Math.PI / 2 };
  }
  if (name === 'night') {
    world.startChapterAt(4);
    state.player.cash = 15900;
    state.player.respect = 410;
    enterStarterCar(world);
    world.setWanted(4);
    runSteps(world, 180, createRouteDriver([...HARBOUR_RUN, { x: 1500, y: 1650 }]));
    stageWreckAhead(world);
    world.setWanted(4);
    state.timeOfDay = 0.9;
    state.mission.intro = 0;
    return { screen: 'play', best: 15900 };
  }
  if (name === 'garage') {
    world.startChapterAt(4);
    state.player.cash = 17100;
    state.player.respect = 410;
    world.garageBuy('sports'); // sports $1200 → cash $15900 after the buy
    state.save.upgrades.sports = { speed: 1, handling: 0, armor: 1 };
    state.player.x = GARAGE.x;
    state.player.y = GARAGE.y + 40;
    state.player.onFoot = true;
    runSteps(world, 60, () => blankInput());
    state.timeOfDay = 0.55;
    state.mission.intro = 0;
    return { screen: 'garage', best: 15900, garageSel: 4, camYaw: Math.PI };
  }
  return { screen: 'play', best: 0 };
}
