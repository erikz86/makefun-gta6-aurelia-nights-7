// Story chapters and side missions: pure rules, no drawing, no browser.
// The world calls startChapter / updateMissions / updateSideMission each step and
// turns the plain results ({chapterDone, victory, sideDone, ...}) into event bits.

import { CHAPTERS, DISTRICTS, districtIndexAt, SIDE_ORDER, SIDE_TYPES } from './config.js';
import { dist2 } from './entities.js';

export const REACH_DIST = 70;

/** Fresh story state: chapter 0, nothing collected yet. */
export function createMissionState() {
  return { chapter: 0, collected: 0, phase: 0, timer: 0, victory: false, intro: 3 };
}

/** Fresh side-mission state: none active, first marker offered after a short wait. */
export function createSideState() {
  return { active: null, cooldown: 8, nextIndex: 0, marker: null };
}

/** Apply a chapter to the world: time of day, starting wanted, cash, timer, intro card. */
export function startChapter(world, index) {
  const chapter = CHAPTERS[index];
  const s = world.state;
  s.mission.chapter = index;
  s.mission.collected = 0;
  s.mission.phase = 0;
  s.mission.timer = chapter.timeLimit || 0;
  s.mission.victory = false;
  s.mission.intro = 3;
  s.timeOfDay = chapter.time;
  s.rain = chapter.time >= 0.7 && chapter.time < 0.9;
  // Route through setWanted so the dispatch feed reports the pursuit.
  world.setWanted(chapter.startWanted || 0);
  if (chapter.type === 'collect' || chapter.type === 'vault') {
    for (let i = 0; i < (chapter.collect || 0) + 2; i += 1) {
      world.spawnCashNear(world.rng.range(200, 3000), world.rng.range(200, 1900), 50);
    }
  }
  if (chapter.type === 'deliver') world.spawnCashNear(1200, 1200, 25);
}

function completeChapter(world) {
  const s = world.state;
  const bonus = 100 * (s.mission.chapter + 1);
  s.player.cash += bonus;
  s.player.cashPop = 1;
  // Respect +100 and district standing +5 where the chapter ended.
  s.player.respect = Math.min(999, s.player.respect + 100);
  const di = districtIndexAt(CHAPTERS[s.mission.chapter].target.x, CHAPTERS[s.mission.chapter].target.y);
  s.districtStanding[di] = Math.min(100, s.districtStanding[di] + 5);
  s.feed = `DARA: chapter cleared — ${DISTRICTS[di].name} standing up, respect +100.`;
  if (s.mission.chapter >= CHAPTERS.length - 1) {
    s.mission.victory = true;
    return { chapterDone: true, victory: true, restarted: false };
  }
  startChapter(world, s.mission.chapter + 1);
  return { chapterDone: true, victory: false, restarted: false };
}

/**
 * Advance the story one step. Returns what happened; the world turns these into
 * event bits and sounds. `px, py` is the player's position.
 */
export function updateMissions(world, dt) {
  const s = world.state;
  const m = s.mission;
  if (m.victory) return { chapterDone: false, victory: false, restarted: false };
  if (m.intro > 0) m.intro -= dt;
  const chapter = CHAPTERS[m.chapter];
  const px = s.player.x;
  const py = s.player.y;
  const reached = dist2(px, py, chapter.target.x, chapter.target.y) < REACH_DIST * REACH_DIST;

  if (chapter.type === 'reach' || chapter.type === 'escape' || chapter.type === 'finale') {
    if (reached) return completeChapter(world);
    return { chapterDone: false, victory: false, restarted: false };
  }
  if (chapter.type === 'collect') {
    if (m.collected >= chapter.collect) return completeChapter(world);
    return { chapterDone: false, victory: false, restarted: false };
  }
  if (chapter.type === 'vault') {
    if (m.phase === 0 && m.collected >= chapter.collect) m.phase = 1;
    if (m.phase === 1 && reached) return completeChapter(world);
    return { chapterDone: false, victory: false, restarted: false };
  }
  if (chapter.type === 'deliver') {
    m.timer -= dt;
    if (m.timer <= 0) {
      // Out of time: the chapter restarts from its beginning.
      startChapter(world, m.chapter);
      return { chapterDone: false, victory: false, restarted: true };
    }
    if (reached) return completeChapter(world);
    return { chapterDone: false, victory: false, restarted: false };
  }
  return { chapterDone: false, victory: false, restarted: false };
}

// ---------------------------------------------------------------- side missions

function roadPoint(world) {
  // A point on a road, deterministic from the world's rng.
  const vertical = world.rng.next() < 0.5;
  if (vertical) {
    return { x: world.rng.choice([400, 1000, 1600, 2200, 2800]), y: world.rng.range(200, 1950) };
  }
  return { x: world.rng.range(200, 3000), y: world.rng.choice([400, 900, 1400, 1900]) };
}

/** Offer the next side-mission marker on the map. */
export function offerSideMarker(world) {
  const s = world.state;
  const type = SIDE_ORDER[s.side.nextIndex % SIDE_ORDER.length];
  s.side.nextIndex += 1;
  const at = roadPoint(world);
  s.side.marker = { type, x: at.x, y: at.y };
}

/** Begin a side mission of `type` at the offered marker. */
export function startSideMission(world, type) {
  const s = world.state;
  const def = SIDE_TYPES[type];
  const marker = s.side.marker || { x: s.player.x + 200, y: s.player.y };
  const active = { type, phase: 'pickup', timer: def.time, reward: def.reward, tx: marker.x, ty: marker.y };
  if (type === 'taxi') {
    // The fare is a pedestrian standing at the marker.
    const ped = world.nearestPed(marker.x, marker.y);
    active.ped = ped || null;
    if (ped) {
      ped.tx = marker.x;
      ped.ty = marker.y;
      ped.wait = 999;
    }
  }
  if (type === 'courier') {
    const far = roadPoint(world);
    active.farX = far.x;
    active.farY = far.y;
  }
  if (type === 'timetrial') {
    active.gates = [];
    active.gate = 0;
    for (let i = 0; i < 4; i += 1) {
      const at = roadPoint(world);
      active.gates.push({ x: at.x, y: at.y });
    }
    active.tx = active.gates[0].x;
    active.ty = active.gates[0].y;
  }
  s.side.active = active;
  s.side.marker = null;
  return active;
}

function finishSide(world, success) {
  const s = world.state;
  const active = s.side.active;
  if (!active) return { sideDone: false, sideFailed: false };
  if (success) {
    s.player.cash += active.reward;
    s.player.cashPop = 1;
    // Respect +50 and district standing +2 where the job finished.
    s.player.respect = Math.min(999, s.player.respect + 50);
    const di = districtIndexAt(s.player.x, s.player.y);
    s.districtStanding[di] = Math.min(100, s.districtStanding[di] + 2);
  }
  if (active.ped) active.ped.inTaxi = false;
  s.side.active = null;
  s.side.cooldown = 10;
  return success ? { sideDone: true, sideFailed: false } : { sideDone: false, sideFailed: true };
}

/** Advance the active side mission one step; returns what happened. */
export function updateSideMission(world, dt) {
  const s = world.state;
  const a = s.side.active;
  if (!a) {
    if (s.side.marker === null) {
      s.side.cooldown -= dt;
      if (s.side.cooldown <= 0) offerSideMarker(world);
    }
    return { sideDone: false, sideFailed: false };
  }
  a.timer -= dt;
  if (a.timer <= 0) return finishSide(world, false);
  const px = s.player.x;
  const py = s.player.y;
  const near = (x, y, d) => dist2(px, py, x, y) < d * d;

  if (a.type === 'taxi') {
    if (a.phase === 'pickup') {
      if (a.ped && near(a.ped.x, a.ped.y, 60)) {
        a.ped.inTaxi = true;
        a.phase = 'drop';
        const far = roadPoint(world);
        a.tx = far.x;
        a.ty = far.y;
      }
    } else if (near(a.tx, a.ty, REACH_DIST)) {
      return finishSide(world, true);
    }
    return { sideDone: false, sideFailed: false };
  }
  if (a.type === 'courier') {
    if (a.phase === 'pickup') {
      if (near(a.tx, a.ty, REACH_DIST)) {
        a.phase = 'drop';
        a.tx = a.farX;
        a.ty = a.farY;
      }
    } else if (near(a.tx, a.ty, REACH_DIST)) {
      return finishSide(world, true);
    }
    return { sideDone: false, sideFailed: false };
  }
  if (a.type === 'timetrial') {
    const gate = a.gates[a.gate];
    if (gate && near(gate.x, gate.y, REACH_DIST)) {
      a.gate += 1;
      if (a.gate >= a.gates.length) return finishSide(world, true);
      a.tx = a.gates[a.gate].x;
      a.ty = a.gates[a.gate].y;
    }
    return { sideDone: false, sideFailed: false };
  }
  return { sideDone: false, sideFailed: false };
}
