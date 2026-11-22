// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between six screens: title, play, paused, garage, game over
// and victory.
//
// ?seed=N fixes the world. ?shot=start|play|chase|sunset|onfoot|night|garage (with
// &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady.
import { FIELD, SAVE_KEY, STEP, VEHICLE_TYPES } from './config.js';
import { createRandom } from './random.js';
import {
  blankInput, createWorld, EVENT_CHAPTER, EVENT_HIT, EVENT_OVER, EVENT_PICKUP,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, ACTION_RADIO, ACTION_REPAIR, createInput,
} from './input.js';
import {
  createRenderer, SCREEN_GARAGE, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY,
  SCREEN_TITLE, SCREEN_VICTORY,
} from './render.js';
import { createAudio } from './audio.js';
import { createPerf } from './perf.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
const VEHICLE_LIST = Object.keys(VEHICLE_TYPES);
const UPGRADE_KINDS = ['speed', 'handling', 'armor'];

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

function runShot(name) {
  const scene = stageShot(name, world);
  renderer.snapCamera(world.state.player.x, world.state.player.y, scene.camYaw, scene.camH);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, { quality: 0, garageSel: scene.garageSel || 0 });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  const audio = createAudio();
  const perf = createPerf();
  let screen = SCREEN_TITLE;
  let best = 0;
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;
  let statusTimer = 0;
  let lastMoveY = 0;

  // Load the save: owned cars, upgrades, best cash.
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) world.applySave(JSON.parse(raw));
    best = world.state.save.bestCash || 0;
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }

  function persist() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.serializeSave()));
    } catch {
      // Ignore.
    }
    best = world.state.save.bestCash || 0;
  }

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    announce('Playing. Chapter 1: Welcome to Aurelia Bay.');
  }

  function endGame() {
    persist();
    screen = world.state.victory ? SCREEN_VICTORY : SCREEN_OVER;
    announce(world.state.victory
      ? `King of the Bay! Cash $${world.state.player.cash}.`
      : `Game over. Cash $${world.state.player.cash}. Best $${best}.`);
  }

  /** Build the world input for one frame from the held keys and the queued presses. */
  function buildInput(actions) {
    const inp = blankInput();
    const p = world.state.player;
    if (p.onFoot) {
      const m = input.move();
      inp.mx = m.x;
      inp.my = m.y;
    } else {
      const d = input.driving();
      inp.accel = d.accel;
      inp.brake = d.brake;
      inp.steer = d.steer;
      inp.handbrake = d.handbrake;
    }
    if (actions & ACTION_ENTER) inp.enter = true;
    if (actions & ACTION_REPAIR) inp.repair = true;
    if (actions & ACTION_RADIO) inp.radio = true;
    const wsel = input.takeWeaponSelect();
    if (wsel !== null) inp.weapon = wsel;
    const csel = input.takeCrewSelect();
    if (csel !== null) inp.crew = csel;
    if (input.isFiring()) {
      inp.fire = true;
      const aim = renderer.screenToWorld(input.mouse.x, input.mouse.y);
      inp.aimX = aim.x;
      inp.aimY = aim.y;
    }
    return inp;
  }

  function handleActions(actions) {
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_VICTORY) {
      if (actions & ACTION_CONFIRM) startGame();
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (screen === SCREEN_GARAGE) {
      // Up/Down moves the selection; Enter buys the selected car; R repairs;
      // 1/2/3 upgrade speed/handling/armor of the selected owned car.
      const move = input.move();
      if (move.y !== 0 && move.y !== lastMoveY) {
        world.state.garageSel = (world.state.garageSel + (move.y > 0 ? 1 : -1) + VEHICLE_LIST.length) % VEHICLE_LIST.length;
      }
      lastMoveY = move.y;
      if (actions & ACTION_CONFIRM) {
        if (world.garageBuy(VEHICLE_LIST[world.state.garageSel])) {
          audio.chime();
          persist();
        }
      }
      if (actions & ACTION_REPAIR) {
        if (world.garageRepair()) {
          audio.chime();
          persist();
        }
      }
      const wsel = input.takeWeaponSelect();
      if (wsel !== null) {
        // Keys 1/2/3 upgrade the selected car; 4/5 buy weapon tiers in the garage.
        if (wsel >= 3) {
          if (world.buyWeapon(wsel === 3 ? '12G' : 'AR-9')) {
            audio.chime();
            persist();
          }
        } else if (world.garageUpgrade(VEHICLE_LIST[world.state.garageSel], UPGRADE_KINDS[wsel])) {
          audio.chime();
          persist();
        }
      }
      if (actions & (ACTION_ENTER | ACTION_PAUSE)) {
        screen = SCREEN_PLAY;
        world.state.garageOpen = false;
        announce('Playing.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  }

  /** A click on the open weapon wheel picks the nearest wedge (5 wedges now). */
  function handleWheelClick() {
    if (!input.takeClick()) return;
    const f = renderer.screenToField(input.mouse.x, input.mouse.y);
    const cx = FIELD.width / 2;
    const cy = FIELD.height / 2;
    const ang = Math.atan2(f.y - cy, f.x - cx);
    const wedgeAngles = [-Math.PI / 2 - 2 * Math.PI / 3, -Math.PI / 2 - Math.PI / 3, -Math.PI / 2, -Math.PI / 2 + Math.PI / 3, -Math.PI / 2 + 2 * Math.PI / 3];
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < 5; i += 1) {
      let d = Math.abs(ang - wedgeAngles[i]);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    world.selectWeapon(bestIdx);
  }

  function step() {
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE) {
      // The city lives behind the title: traffic, pedestrians, the day cycle.
      world.step(STEP, blankInput(), true);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const events = world.step(STEP, buildInput(actions), false);
    if (events & EVENT_PICKUP) audio.chime();
    if (events & EVENT_HIT) audio.thud();
    if (events & EVENT_CHAPTER) audio.sting();
    if (world.state.garageOpen) {
      world.state.garageOpen = false;
      screen = SCREEN_GARAGE;
      announce('Garage. Up and Down choose a car, Enter buys it, R repairs, 1 2 3 upgrade.');
    }
    if (events & EVENT_OVER) endGame();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const quality = perf.update(dt);
    accumulator += dt;
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      // Paused, garage and end screens still read their keys, but the world stands still.
      const actions = input.takeActions();
      handleActions(actions);
      accumulator = 0;
    }
    const wheel = input.isWheelHeld() && screen === SCREEN_PLAY;
    if (wheel) handleWheelClick();
    if (screen === SCREEN_PLAY) {
      const car = world.state.playerCar;
      audio.engine(car ? Math.min(1, Math.abs(car.speed) / 400) : 0);
      audio.siren(world.state.player.wanted > 0);
      audio.radioTick(dt);
    }
    saveTimer += dt;
    if (saveTimer > 10) {
      saveTimer = 0;
      persist();
    }
    statusTimer += dt;
    if (statusTimer > 1) {
      statusTimer = 0;
      const p = world.state.player;
      announce(`Chapter ${world.state.mission.chapter + 1}, cash $${p.cash}, wanted ${p.wanted}.`);
    }
    renderer.draw(world.state, screen, best, {
      quality,
      fps: perf.fps,
      wheel,
      garageSel: world.state.garageSel,
    });
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Aurelia Nights VII. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
