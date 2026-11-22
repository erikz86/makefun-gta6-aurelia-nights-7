// Logic tests for Aurelia Nights VII. Node stdlib only: the world, missions, entities,
// config, random, perf and audio modules are all DOM-free, so the whole rule set runs
// headless. Run: node tools/test-game.mjs — exits 0 when every check passes.

import { createRandom } from '../game/src/random.js';
import {
  blankInput, createWorld, EVENT_BUSTED, EVENT_CHAPTER, EVENT_EMPTY, EVENT_OVER,
  EVENT_PICKUP, EVENT_SIDE,
} from '../game/src/world.js';
import { createPolice } from '../game/src/entities.js';
import { createPerf } from '../game/src/perf.js';
import { createAudio } from '../game/src/audio.js';
import { CHAPTERS, CREW, DIALOG, DISTRICTS, districtIndexAt, POLICE, rankFor, standingLabel, STEP, VEHICLE_TYPES, WEAPONS } from '../game/src/config.js';
import { createRouteDriver, stageShot } from '../game/src/shots.js';
import { cameraZoom, feedDisplay, formatClock, groundPoint, humanoidHeight, makeCamera, prepareCamera, projectPoint, slotSuffix } from '../game/src/render.js';

/** The harbour run: south down the x=400 road, then east along y=1650. */
const HARBOUR_ROUTE = [{ x: 400, y: 1650 }, { x: 2500, y: 1650 }];

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`ok - ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL - ${name}${extra ? ` :: ${extra}` : ''}`);
  }
}

function fresh(seed = 1) {
  return createWorld(createRandom(seed));
}

function stepN(world, n, inputFn) {
  let events = 0;
  for (let i = 0; i < n; i += 1) {
    events |= world.step(STEP, inputFn ? inputFn(world.state) : blankInput());
  }
  return events;
}

function enterNearestCar(world) {
  const s = world.state;
  const p = s.player;
  let nearest = null;
  let nd = Infinity;
  for (const c of s.cars) {
    if (!c.parked) continue;
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < nd) {
      nd = d;
      nearest = c;
    }
  }
  if (!nearest) return false;
  p.x = nearest.x + 10;
  p.y = nearest.y;
  const inp = blankInput();
  inp.enter = true;
  world.step(STEP, inp);
  return !p.onFoot && s.playerCar === nearest;
}

function teleport(world, x, y) {
  const s = world.state;
  s.player.x = x;
  s.player.y = y;
  if (s.playerCar) {
    s.playerCar.x = x;
    s.playerCar.y = y;
  }
}

/** Try to stand on a point (and small offsets around it) until `done()` is true. */
function reachPoint(world, x, y, done) {
  const offsets = [[0, 0], [90, 0], [-90, 0], [0, 90], [0, -90], [120, 120], [-120, -120]];
  for (const [dx, dy] of offsets) {
    teleport(world, x + dx, y + dy);
    stepN(world, 3);
    if (done()) return true;
  }
  return done();
}

// ---------------------------------------------------------- controls

{
  const w = fresh();
  check('kontrol: masuk mobil parkir dengan E', enterNearestCar(w));
  const car = w.state.playerCar;
  check('kontrol: mobil pemain terisi', car !== null && car.type === 'sedan');
  check('kontrol: sedan starter menghadap ke selatan di jalan', Math.abs(car.angle - Math.PI / 2) < 0.01 && Math.abs(car.x - 400) < 1, `x=${car.x} angle=${car.angle.toFixed(2)}`);
  stepN(w, 120, createRouteDriver(HARBOUR_ROUTE));
  check('kontrol: akselerasi menggerakkan mobil', Math.abs(car.speed) > 150, `speed=${Math.round(car.speed)}`);
  const inp = blankInput();
  inp.enter = true;
  w.step(STEP, inp);
  check('kontrol: keluar mobil dengan E', w.state.player.onFoot && w.state.playerCar === null);
}

// ---------------------------------------------------------- cash + combo

{
  const w = fresh();
  const s = w.state;
  const before = s.player.cash;
  w.spawnCashNear(s.player.x + 5, s.player.y + 5, 10);
  const pk = s.pickups.find((p) => p.active && p.kind === 'cash');
  teleport(w, pk.x, pk.y);
  const ev = stepN(w, 3);
  check('cash: ambil pickup menambah cash', (ev & EVENT_PICKUP) !== 0 && s.player.cash > before, `cash=${s.player.cash}`);
  w.spawnCashNear(s.player.x + 5, s.player.y + 5, 10);
  const pk2 = s.pickups.find((p) => p.active && p.kind === 'cash');
  teleport(w, pk2.x, pk2.y);
  stepN(w, 3);
  check('kombo: pickup beruntun menaikkan kombo', s.player.combo >= 2, `combo=${s.player.combo}`);
}

// ---------------------------------------------------------- repair

{
  const w = fresh();
  enterNearestCar(w);
  const s = w.state;
  s.playerCar.health = 40;
  s.player.cash = 5000;
  const inp = blankInput();
  inp.repair = true;
  w.step(STEP, inp);
  check('repair: R memperbaiki mobil dan memotong cash', s.playerCar.health > 40 && s.player.cash < 5000, `health=${s.playerCar.health} cash=${s.player.cash}`);
}

// ---------------------------------------------------------- crash damage + busted + restart

{
  const w = fresh();
  enterNearestCar(w);
  const s = w.state;
  // A cruiser ramming the player's car at speed must hurt: pin it on the car.
  s.playerCar.speed = 300;
  const cop = createPolice(s.player.x, s.player.y);
  s.police.push(cop);
  for (let i = 0; i < 5; i += 1) {
    cop.x = s.player.x;
    cop.y = s.player.y;
    w.step(STEP, blankInput());
  }
  check('damage: tabrakan polisi mengurangi health mobil', s.playerCar.health < 100, `carHealth=${s.playerCar.health} playerHealth=${s.player.health}`);
}

{
  const w = fresh();
  const s = w.state;
  // Pin the cruiser on the slow on-foot player: the bust timer must fire.
  const cop = createPolice(s.player.x, s.player.y);
  s.police.push(cop);
  for (let i = 0; i < 120; i += 1) {
    cop.x = s.player.x;
    cop.y = s.player.y;
    cop.speed = 0;
    w.step(STEP, blankInput());
  }
  check('game over: polisi menangkap pemain lambat (busted)', s.over && s.busted, `over=${s.over} busted=${s.busted}`);
  w.reset();
  check('restart: reset mengembalikan state awal', !s.over && !s.busted && s.player.health === 100 && s.player.wanted === 0);
}

// ---------------------------------------------------------- chapters 0-5 + victory

{
  const w = fresh(7);
  const s = w.state;
  s.player.health = 100000; // Police may chase during the scripted run; health is not under test here.
  let guard = 0;
  let chapterBonusSeen = false;
  const cashBefore = s.player.cash;
  while (!s.victory && guard < 300) {
    guard += 1;
    const idx = s.mission.chapter;
    const ch = CHAPTERS[idx];
    if (ch.type === 'reach' || ch.type === 'escape' || ch.type === 'finale') {
      reachPoint(w, ch.target.x, ch.target.y, () => s.mission.chapter !== idx);
    } else if (ch.type === 'collect' || ch.type === 'vault') {
      if (s.mission.collected < ch.collect) {
        // Collect the nearest active cash drop; skip any that cannot be reached.
        let collected = false;
        const drops = s.pickups.filter((p) => p.active && p.kind === 'cash');
        for (const pk of drops) {
          const before = s.mission.collected;
          if (reachPoint(w, pk.x, pk.y, () => s.mission.collected > before)) {
            collected = true;
            break;
          }
        }
        if (!collected) stepN(w, 3);
      } else if (ch.type === 'vault') {
        reachPoint(w, ch.target.x, ch.target.y, () => s.mission.chapter !== idx);
      } else {
        stepN(w, 3);
      }
    } else if (ch.type === 'deliver') {
      reachPoint(w, ch.target.x, ch.target.y, () => s.mission.chapter !== idx);
    } else {
      stepN(w, 3);
    }
    if (s.player.cash > cashBefore) chapterBonusSeen = true;
  }
  check('chapter: 10 chapter selesai sampai victory', s.victory && s.over, `chapter=${s.mission.chapter} victory=${s.victory} guard=${guard}`);
  check('chapter: bonus chapter masuk ke cash pemain', chapterBonusSeen, `cash=${s.player.cash}`);
}

// ---------------------------------------------------------- police, roadblock, helicopter

{
  const w = fresh();
  const s = w.state;
  w.setWanted(3);
  const drive = createRouteDriver(HARBOUR_ROUTE);
  for (let i = 0; i < 180; i += 1) {
    if (i % 30 === 0) w.setWanted(3); // Stay visibly criminal: wanted must not decay mid-test.
    w.step(STEP, drive(w.state));
  }
  check('polisi: wanted 3 memunculkan patroli kejar', s.police.length >= 4, `police=${s.police.length}`);
  check('polisi: wanted 3 memunculkan roadblock', s.roadblocks.length >= 1, `roadblocks=${s.roadblocks.length}`);
}

{
  const w = fresh();
  const s = w.state;
  w.setWanted(5);
  for (let i = 0; i < 90; i += 1) {
    if (i % 30 === 0) w.setWanted(5);
    w.step(STEP, blankInput());
  }
  check('helikopter: spawn di wanted 5', s.heli !== null);
  check('helikopter: posisi mengikuti pemain', s.heli !== null && Math.abs(s.heli.x - s.player.x) < 500, s.heli ? `dx=${Math.round(s.heli.x - s.player.x)}` : 'no heli');
  w.setWanted(0);
  stepN(w, 90);
  check('helikopter: hilang saat wanted turun', s.heli === null);
  check('polisi: kembali ke patroli saat wanted 0', s.police.length === POLICE.patrolCount, `police=${s.police.length}`);
}

// ---------------------------------------------------------- weapons

{
  const w = fresh();
  const s = w.state;
  w.selectWeapon(1);
  check('senjata: pilih pistol lewat wheel', s.player.weapon === 1);
  const inp = blankInput();
  inp.fire = true;
  inp.aimX = s.player.x + 300;
  inp.aimY = s.player.y;
  w.step(STEP, inp);
  check('senjata: tembak mengurangi ammo pistol', s.player.ammoPistol < 24, `ammo=${s.player.ammoPistol}`);
  check('senjata: tembakan tercatat', s.stats.shots >= 1, `shots=${s.stats.shots}`);
  s.player.ammoPistol = 1;
  s.player.fireCd = 0;
  const fireOnce = () => {
    const i = blankInput();
    i.fire = true;
    i.aimX = s.player.x + 300;
    i.aimY = s.player.y;
    return i;
  };
  w.step(STEP, fireOnce());
  check('senjata: ammo terakhir habis setelah tembakan', s.player.ammoPistol === 0);
  stepN(w, 20);
  const ev = w.step(STEP, fireOnce());
  check('senjata: tembak tanpa ammo memberi EVENT_EMPTY', (ev & EVENT_EMPTY) !== 0);
  w.selectWeapon(2);
  check('senjata: pilih SMG lewat wheel', s.player.weapon === 2);
}

// ---------------------------------------------------------- garage + save

{
  const w = fresh();
  const s = w.state;
  s.player.cash = 100000;
  const price = VEHICLE_TYPES.sports.price;
  const bought = w.garageBuy('sports');
  check('garage: beli sports memotong cash dan masuk owned', bought && s.save.owned.includes('sports') && s.player.cash === 100000 - price, `cash=${s.player.cash}`);
  const upgraded = w.garageUpgrade('sports', 'speed');
  check('garage: upgrade speed level 1', upgraded && s.save.upgrades.sports.speed === 1 && s.player.cash === 100000 - price - 200, `cash=${s.player.cash}`);
  const lvl2Blocked = w.garageUpgrade('sports', 'speed');
  check('rank: upgrade level 2 ditolak saat rank STREET', lvl2Blocked === false && s.save.upgrades.sports.speed === 1, `speed=${s.save.upgrades.sports.speed}`);
  s.player.respect = 150;
  const lvl2Ok = w.garageUpgrade('sports', 'speed');
  check('rank: upgrade level 2 lolos saat rank FIXER', lvl2Ok && s.save.upgrades.sports.speed === 2, `speed=${s.save.upgrades.sports.speed}`);
  const lvl3Blocked = w.garageUpgrade('sports', 'speed');
  check('rank: upgrade level 3 ditolak saat rank FIXER', lvl3Blocked === false && s.save.upgrades.sports.speed === 2, `speed=${s.save.upgrades.sports.speed}`);
  s.player.respect = 400;
  const lvl3Ok = w.garageUpgrade('sports', 'speed');
  check('rank: upgrade level 3 lolos saat rank SHOT CALLER', lvl3Ok && s.save.upgrades.sports.speed === 3, `speed=${s.save.upgrades.sports.speed}`);
  const again = w.garageBuy('sports');
  check('garage: tidak bisa beli mobil yang sudah dimiliki', again === false);
  const saved = w.serializeSave();
  const w2 = fresh(99);
  const loaded = w2.applySave(JSON.parse(JSON.stringify(saved)));
  check('save: owned + upgrade + bestCash bertahan setelah load', loaded && w2.state.save.owned.includes('sports') && w2.state.save.upgrades.sports.speed === 3 && w2.state.save.bestCash === saved.bestCash, `bestCash=${w2.state.save.bestCash}`);
}

// ---------------------------------------------------------- config: 10 chapter, dialog, crew, senjata, distrik

{
  check('config: 10 chapter cerita', CHAPTERS.length === 10, `n=${CHAPTERS.length}`);
  check('config: dialog 1 baris per chapter dari DARA', DIALOG.length === 10 && DIALOG.every((d) => d.speaker === 'DARA' && d.line.length > 10), `n=${DIALOG.length}`);
  check('config: kru 3 anggota bernama', CREW.length === 3 && CREW.map((c) => c.name).join(',') === 'Raka,Sinta,Bimo', `crew=${CREW.map((c) => c.name).join(',')}`);
  check('config: 5 tier senjata', WEAPONS.length === 5 && WEAPONS.map((x) => x.name).join(',') === 'Fists,.38,SMG,12G,AR-9', `weapons=${WEAPONS.map((x) => x.name).join(',')}`);
  check('config: tiap mobil punya nama display', Object.values(VEHICLE_TYPES).every((v) => v.display && v.display.length > 2), `displays=${Object.values(VEHICLE_TYPES).map((v) => v.display).join(',')}`);
  check('config: 5 distrik kota', DISTRICTS.length === 5 && DISTRICTS.map((d) => d.name).join(',') === 'OLD TOWN,DOWNTOWN,MARINA,HARBOR,BAYFRONT', `districts=${DISTRICTS.map((d) => d.name).join(',')}`);
}

// ---------------------------------------------------------- respect, rank, district standing

{
  check('rank: ambang STREET 0 / FIXER 150 / SHOT CALLER 400', rankFor(0) === 0 && rankFor(149) === 0 && rankFor(150) === 1 && rankFor(399) === 1 && rankFor(400) === 2 && rankFor(999) === 2, `r0=${rankFor(0)} r150=${rankFor(150)} r400=${rankFor(400)}`);
  check('district: posisi memetakan ke distrik benar', districtIndexAt(400, 400) === 0 && districtIndexAt(1500, 400) === 1 && districtIndexAt(2500, 400) === 2 && districtIndexAt(800, 1500) === 3 && districtIndexAt(2500, 1500) === 4, `d=${districtIndexAt(400, 400)},${districtIndexAt(1500, 400)},${districtIndexAt(2500, 400)},${districtIndexAt(800, 1500)},${districtIndexAt(2500, 1500)}`);
  check('district: label standing HOSTILE/NEUTRAL/FRIENDLY/ALLY', standingLabel(20) === 'HOSTILE' && standingLabel(40) === 'NEUTRAL' && standingLabel(60) === 'FRIENDLY' && standingLabel(90) === 'ALLY', `labels=${standingLabel(20)},${standingLabel(40)},${standingLabel(60)},${standingLabel(90)}`);
  const w = fresh();
  const s = w.state;
  w.spawnCashNear(s.player.x + 5, s.player.y + 5, 10);
  const pk = s.pickups.find((p) => p.active && p.kind === 'cash');
  teleport(w, pk.x, pk.y);
  stepN(w, 3);
  check('respect: ambil cash menaikkan respect +10', s.player.respect >= 10, `respect=${s.player.respect}`);
}

// ---------------------------------------------------------- crew (3 ability aktif)

{
  const w = fresh();
  const s = w.state;
  w.setWanted(4);
  const used = w.useCrew(0);
  check('crew driver: Clean Plate menurunkan wanted 2 level', used && s.player.wanted === 2, `wanted=${s.player.wanted}`);
  check('crew driver: cooldown 45 detik terpasang', s.crew.driver === 45, `cd=${s.crew.driver}`);
  check('crew driver: tidak bisa dipakai saat cooldown', w.useCrew(0) === false);
  s.crew.driver = 1;
  w.setWanted(0);
  stepN(w, 70);
  check('crew: cooldown berkurang tiap langkah', s.crew.driver === 0, `cd=${s.crew.driver}`);
  check('crew driver: tidak ada efek saat wanted 0', w.useCrew(0) === false);
}

{
  const w = fresh();
  const s = w.state;
  check('crew mechanic: tidak ada efek saat mobil sehat', w.useCrew(1) === false);
  enterNearestCar(w);
  s.playerCar.health = 40;
  const fixed = w.useCrew(1);
  check('crew mechanic: Field Fix memperbaiki mobil ke 100', fixed && s.playerCar.health === 100, `health=${s.playerCar.health}`);
  check('crew mechanic: cooldown 60 detik terpasang', s.crew.mechanic === 60, `cd=${s.crew.mechanic}`);
}

{
  const w = fresh();
  const s = w.state;
  const eyed = w.useCrew(2);
  check('crew lookout: Eagle Eye membuka jendela 20 detik', eyed && s.crew.lookoutUntil === s.elapsed + 20, `until=${s.crew.lookoutUntil} elapsed=${s.elapsed}`);
  check('crew lookout: cooldown 30 detik terpasang', s.crew.lookout === 30, `cd=${s.crew.lookout}`);
}

// ---------------------------------------------------------- weapon tiers

{
  const w = fresh();
  const s = w.state;
  check('senjata: AR-9 tidak bisa dipilih sebelum dibeli', w.selectWeapon(4) === false && s.player.weapon === 0);
  check('senjata: beli 12G ditolak saat rank STREET', w.buyWeapon('12G') === false && !s.save.weapons.includes('12G'));
  s.player.respect = 150;
  s.player.cash = 1000;
  const bought12 = w.buyWeapon('12G');
  check('senjata: beli 12G lolos saat rank FIXER + cash cukup', bought12 && s.save.weapons.includes('12G') && s.player.cash === 400, `cash=${s.player.cash}`);
  check('senjata: pilih 12G setelah dibeli', w.selectWeapon(3) && s.player.weapon === 3);
  check('senjata: beli AR-9 ditolak saat rank FIXER', w.buyWeapon('AR-9') === false);
  s.player.respect = 400;
  s.player.cash = 2000;
  const boughtAr = w.buyWeapon('AR-9');
  check('senjata: beli AR-9 lolos saat rank SHOT CALLER', boughtAr && s.save.weapons.includes('AR-9') && s.player.cash === 500, `cash=${s.player.cash}`);
  s.player.fireCd = 0;
  const ammoBefore = s.player.ammoShotgun;
  w.selectWeapon(3);
  const inp = blankInput();
  inp.fire = true;
  inp.aimX = s.player.x + 300;
  inp.aimY = s.player.y;
  w.step(STEP, inp);
  check('senjata: tembak 12G memakai ammoShotgun', s.player.ammoShotgun < ammoBefore, `ammo=${s.player.ammoShotgun} before=${ammoBefore}`);
  const saved = w.serializeSave();
  const w2 = fresh(99);
  w2.applySave(JSON.parse(JSON.stringify(saved)));
  check('save: senjata yang dibeli bertahan setelah load', w2.state.save.weapons.includes('12G') && w2.state.save.weapons.includes('AR-9'), `weapons=${w2.state.save.weapons.join(',')}`);
}

// ---------------------------------------------------------- radio

{
  const w = fresh();
  check('radio: cycling 0 -> 1 -> 2 -> 0', w.cycleRadio() === 1 && w.cycleRadio() === 2 && w.cycleRadio() === 0);
}

// ---------------------------------------------------------- side missions (3 jenis)

function runSideMission(type, reward) {
  const w = fresh();
  const s = w.state;
  const cashBefore = s.player.cash;
  s.side.marker = { type, x: s.player.x + 30, y: s.player.y };
  stepN(w, 3);
  check(`side ${type}: marker memulai misi`, s.side.active !== null && s.side.active.type === type);
  if (!s.side.active) return;
  if (type === 'taxi') {
    const ped = s.side.active.ped;
    if (ped) {
      teleport(w, ped.x, ped.y);
      stepN(w, 3);
    }
    check(`side ${type}: penumpang naik`, s.side.active === null || s.side.active.phase === 'drop', `phase=${s.side.active ? s.side.active.phase : 'done'}`);
  }
  if (type === 'courier') {
    stepN(w, 3); // Already standing on the pickup point.
    check(`side ${type}: paket diambil`, s.side.active === null || s.side.active.phase === 'drop', `phase=${s.side.active ? s.side.active.phase : 'done'}`);
  }
  if (type === 'timetrial') {
    // Gates are visited by teleporting in order.
  }
  let guard = 0;
  while (s.side.active && guard < 10) {
    guard += 1;
    const a = s.side.active;
    teleport(w, a.tx, a.ty);
    stepN(w, 3);
  }
  check(`side ${type}: selesai dan reward masuk`, s.side.active === null && s.player.cash === cashBefore + reward, `cash=${s.player.cash} expected=${cashBefore + reward}`);
}

runSideMission('taxi', 150);
runSideMission('courier', 200);
runSideMission('timetrial', 250);

// ---------------------------------------------------------- audio + perf (Node-safe)

{
  const audio = createAudio();
  let threw = false;
  try {
    audio.unlock();
    audio.chime();
    audio.thud();
    audio.shoot(1);
    audio.sting();
    audio.engine(0.5);
    audio.siren(true);
    audio.setRadio(2);
    audio.radioTick(0.5);
    audio.setMuted(true);
    audio.setMuted(false);
  } catch (e) {
    threw = true;
  }
  check('audio: semua method aman tanpa AudioContext (Node)', !threw);
}

{
  const perf = createPerf();
  for (let i = 0; i < 120; i += 1) perf.update(1 / 30); // 4s at 30fps
  check('perf: kualitas turun saat FPS rendah', perf.quality >= 1, `quality=${perf.quality}`);
  for (let i = 0; i < 700; i += 1) perf.update(1 / 60); // ~11.7s at 60fps, with margin for float windows
  check('perf: kualitas kembali naik saat FPS pulih', perf.quality === 0, `quality=${perf.quality}`);
}

// ---------------------------------------------------------- determinism

{
  const a = fresh(42);
  const b = fresh(42);
  const driveA = createRouteDriver(HARBOUR_ROUTE);
  const driveB = createRouteDriver(HARBOUR_ROUTE);
  enterNearestCar(a);
  enterNearestCar(b);
  stepN(a, 120, driveA);
  stepN(b, 120, driveB);
  check('determinisme: seed sama + input sama = posisi sama', a.state.player.x === b.state.player.x && a.state.player.y === b.state.player.y, `a=(${Math.round(a.state.player.x)},${Math.round(a.state.player.y)}) b=(${Math.round(b.state.player.x)},${Math.round(b.state.player.y)})`);
}

// ---------------------------------------------------------- shot staging

{
  const w = fresh(1);
  const chase = stageShot('chase', w);
  check('shot chase: wanted 5 + heli + roadblock', w.state.player.wanted === 5 && w.state.heli !== null && w.state.roadblocks.length >= 1, `wanted=${w.state.player.wanted} heli=${!!w.state.heli} rb=${w.state.roadblocks.length}`);
  check('shot chase: screen play', chase.screen === 'play');
  check('shot chase: chapter lanjut + uang + senja', w.state.mission.chapter === 5 && w.state.player.cash === 12480 && w.state.timeOfDay === 0.62, `chapter=${w.state.mission.chapter} cash=${w.state.player.cash} tod=${w.state.timeOfDay}`);
  {
    // The cover frame shows a burning wreck ahead of the player's car.
    const pc = w.state.playerCar;
    const fx = Math.cos(pc.angle);
    const fy = Math.sin(pc.angle);
    const wrecks = w.state.cars.filter((c) => c.parked && c.health === 12);
    check('shot chase: wreck terbakar di depan mobil (cover)', wrecks.length >= 1 && wrecks.some((c) => { const f = (c.x - pc.x) * fx + (c.y - pc.y) * fy; return f > 250 && f < 460; }), `wrecks=${wrecks.length}`);
  }
  const w2 = fresh(1);
  const onfoot = stageShot('onfoot', w2);
  check('shot onfoot: pemain jalan kaki di plaza', w2.state.player.onFoot && Math.abs(w2.state.player.x - 1600) < 5 && Math.abs(w2.state.player.y - 1970) < 5, `onFoot=${w2.state.player.onFoot} x=${Math.round(w2.state.player.x)} y=${Math.round(w2.state.player.y)}`);
  check('shot onfoot: misi berjalan + wanted 2', w2.state.mission.collected === 2 && w2.state.player.wanted === 2, `collected=${w2.state.mission.collected} wanted=${w2.state.player.wanted}`);
  check('shot onfoot: screen play', onfoot.screen === 'play');
  check('shot onfoot: camYaw -PI/2 (kamera menghadap utara/kota)', onfoot.camYaw === -Math.PI / 2, `camYaw=${onfoot.camYaw}`);
  const w3 = fresh(1);
  stageShot('night', w3);
  check('shot night: malam (timeOfDay 0.9)', w3.state.timeOfDay === 0.9);
  check('shot night: chapter 4 + uang + wanted 4', w3.state.mission.chapter === 4 && w3.state.player.cash === 15900 && w3.state.player.wanted === 4, `chapter=${w3.state.mission.chapter} cash=${w3.state.player.cash} wanted=${w3.state.player.wanted}`);
  {
    // Wreck + crowd must sit ahead of where the player ends up (3D camera looks forward).
    const pc = w3.state.playerCar;
    const fx = Math.cos(pc.angle);
    const fy = Math.sin(pc.angle);
    const fwdOf = (x, y) => (x - pc.x) * fx + (y - pc.y) * fy;
    const latOf = (x, y) => (x - pc.x) * -fy + (y - pc.y) * fx;
    const wrecks = w3.state.cars.filter((c) => c.parked && c.health === 12);
    const wreckAhead = wrecks.some((c) => { const f = fwdOf(c.x, c.y); return f > 300 && f < 460 && Math.abs(latOf(c.x, c.y)) < 150; });
    check('shot night: wreck di depan mobil (forward ~380)', wrecks.length >= 1 && wreckAhead, `wrecks=${wrecks.length}`);
    const crowdAhead = w3.state.peds.filter((pd) => pd.wait === 999 && fwdOf(pd.x, pd.y) > 200 && fwdOf(pd.x, pd.y) < 650).length;
    check('shot night: kerumunan di depan mobil', crowdAhead >= 8, `crowd=${crowdAhead}`);
  }
  const w4 = fresh(1);
  const garage = stageShot('garage', w4);
  check('shot garage: screen garage + sports dimiliki', garage.screen === 'garage' && w4.state.save.owned.includes('sports'), `screen=${garage.screen} owned=${w4.state.save.owned.join(',')}`);
  check('shot garage: camYaw PI (kamera menghadap barat/kota)', garage.camYaw === Math.PI, `camYaw=${garage.camYaw}`);
  const w5 = fresh(1);
  const play = stageShot('play', w5);
  check('shot play: mobil melaju ke selatan lalu timur', w5.state.player.y > 1400, `x=${Math.round(w5.state.player.x)} y=${Math.round(w5.state.player.y)}`);
  check('shot play: screen play', play.screen === 'play');
  check('shot play: chapter lanjut + uang', w5.state.mission.chapter === 1 && w5.state.player.cash === 850, `chapter=${w5.state.mission.chapter} cash=${w5.state.player.cash}`);
  const w6 = fresh(1);
  const start = stageShot('start', w6);
  check('shot start: screen title', start.screen === 'title');
}

// ---------------------------------------------------------- 3D projection (pure exports from render.js)

{
  const cam = makeCamera(1280, 720);
  cam.x = 700;
  cam.y = 1200;
  cam.yaw = 0;
  prepareCamera(cam);
  const look = projectPoint(cam, 1400, 1200, 0);
  check('3d: titik look-distance di tengah layar', look !== null && Math.abs(look.x - 640) < 1 && Math.abs(look.y - 360) < 5, look ? `x=${look.x.toFixed(1)} y=${look.y.toFixed(1)}` : 'null');
  const carPt = projectPoint(cam, 1000, 1200, 0);
  check('3d: mobil pemain di bawah horizon', carPt !== null && carPt.y > cam.horizonY, carPt ? `y=${carPt.y.toFixed(1)} horizon=${cam.horizonY.toFixed(1)}` : 'null');
  const heliPt = projectPoint(cam, 1000, 1200, 220);
  check('3d: helikopter di langit (di atas horizon)', heliPt !== null && heliPt.y < cam.horizonY, heliPt ? `y=${heliPt.y.toFixed(1)} horizon=${cam.horizonY.toFixed(1)}` : 'null');
  check('3d: titik di belakang kamera = null', projectPoint(cam, 600, 1200, 0) === null);
  const g = groundPoint(cam, 640, 500);
  const back = g ? projectPoint(cam, g.x, g.y, 0) : null;
  check('3d: proyeksi <-> invers round-trip', back !== null && Math.abs(back.x - 640) < 2 && Math.abs(back.y - 500) < 2, back ? `x=${back.x.toFixed(1)} y=${back.y.toFixed(1)}` : 'null');
  check('3d: piksel langit = null', groundPoint(cam, 640, 100) === null);
}

// ---------------------------------------------------------- round 12 helpers (pure exports from render.js)

{
  check('r12: formatClock 149 detik = 2:29', formatClock(149) === '2:29', `got=${formatClock(149)}`);
  check('r12: formatClock 5 detik = 0:05', formatClock(5) === '0:05', `got=${formatClock(5)}`);
  check('r12: formatClock 0 = 0:00', formatClock(0) === '0:00');
  check('r12: feedDisplay mengganti distrik pursuit ke distrik kini', feedDisplay('APD DISPATCH: pursuit in OLD TOWN — 5 stars out.', 'HARBOR') === 'APD DISPATCH: pursuit in HARBOR — 5 stars out.', `got=${feedDisplay('APD DISPATCH: pursuit in OLD TOWN — 5 stars out.', 'HARBOR')}`);
  check('r12: feedDisplay tidak mengubah baris non-pursuit', feedDisplay('GARAGE: SULTAN RS bought — ready to roll.', 'HARBOR') === 'GARAGE: SULTAN RS bought — ready to roll.');
  check('r12: slotSuffix tier terkunci menampilkan harga', slotSuffix(WEAPONS[3], false, 0) === ' · $600' && slotSuffix(WEAPONS[4], false, 0) === ' · $1500', `got=${slotSuffix(WEAPONS[3], false, 0)}`);
  check('r12: slotSuffix tier terkunci gratis tetap LOCK', slotSuffix(WEAPONS[0], false, 0) === ' · LOCK');
  check('r12: slotSuffix senjata dimiliki menampilkan ammo', slotSuffix(WEAPONS[2], true, 90) === ' 90');
  check('r12: humanoidHeight dibatasi 130 piksel', humanoidHeight(18, 10) === 130, `got=${humanoidHeight(18, 10)}`);
  check('r12: humanoidHeight skala normal tidak terpotong', Math.abs(humanoidHeight(14, 1) - 40.6) < 0.01, `got=${humanoidHeight(14, 1)}`);
  check('r13: cameraZoom tanpa trauma dan diam = 1', cameraZoom(0, 0) === 1, `got=${cameraZoom(0, 0)}`);
  check('r13: cameraZoom tendangan ramming zoom masuk', cameraZoom(1, 0) === 1.05, `got=${cameraZoom(1, 0)}`);
  check('r13: cameraZoom kecepatan tinggi melebar, dibatasi 0.94', cameraZoom(0, 6000) === 0.94, `got=${cameraZoom(0, 6000)}`);
}

// ---------------------------------------------------------- performance smoke test

{
  const w = fresh(1);
  enterNearestCar(w);
  const drive = createRouteDriver(HARBOUR_ROUTE);
  const t0 = performance.now();
  const steps = 600;
  for (let i = 0; i < steps; i += 1) {
    w.step(STEP, drive(w.state));
  }
  const totalMs = performance.now() - t0;
  const avg = totalMs / steps;
  console.log(`perf smoke: ${steps} langkah dalam ${totalMs.toFixed(1)} ms = ${avg.toFixed(3)} ms/langkah`);
  check('perf smoke: rata-rata < 5 ms/langkah', avg < 5, `avg=${avg.toFixed(3)} ms`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failures.length > 0) console.log(`Failures: ${failures.join(', ')}`);
process.exit(failed === 0 ? 0 : 1);
