// Aurelia Nights VII — every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window. The world itself is a 3200x2400 harbor city the camera roams over.

export const FIELD = { width: 1280, height: 720 };
export const WORLD = { width: 3200, height: 2400 };
export const STEP = 1 / 60;
export const SAVE_KEY = 'aurelia-nights-vii.save.v1';

/** Roads: vertical x lines and horizontal y lines; the blocks between hold buildings. */
export const ROADS_V = [400, 1000, 1600, 2200, 2800];
export const ROADS_H = [400, 900, 1400, 1900];
export const ROAD_W = 120;
/** Everything south of this line is the bay; a sand strip sits just above it. */
export const WATER_Y = 2100;
export const BEACH_Y = 2040;

export const PLAYER = {
  walkSpeed: 230,
  radius: 14,
  health: 100,
  enterDist: 70,
};

/** 6 drivable vehicle types: size, speed, handling, colour, garage price (0 = owned). */
export const VEHICLE_TYPES = {
  sedan:   { label: 'Sedan',    display: 'VESPER GT',  w: 72, h: 34, topSpeed: 520, accel: 420, reverse: 200, grip: 2.6, color: '#4fc3f7', color2: '#0288d1', price: 0 },
  taxi:    { label: 'Taxi',     display: 'KOTA CAB',   w: 72, h: 34, topSpeed: 540, accel: 440, reverse: 210, grip: 2.7, color: '#ffca28', color2: '#ff8f00', price: 250 },
  van:     { label: 'Van',      display: 'KARGO VAN',  w: 84, h: 38, topSpeed: 460, accel: 340, reverse: 180, grip: 2.2, color: '#a1887f', color2: '#6d4c41', price: 450 },
  truck:   { label: 'Truck',    display: 'BADAK TRUCK', w: 104, h: 40, topSpeed: 420, accel: 300, reverse: 160, grip: 1.9, color: '#90a4ae', color2: '#546e7a', price: 700 },
  sports:  { label: 'Sports',   display: 'SULTAN RS',  w: 76, h: 32, topSpeed: 640, accel: 560, reverse: 230, grip: 3.1, color: '#ef5350', color2: '#b71c1c', price: 1200 },
  cruiser: { label: 'Cruiser',  display: 'FALCON GT',  w: 76, h: 36, topSpeed: 600, accel: 520, reverse: 220, grip: 2.9, color: '#1e88e5', color2: '#0d47a1', price: 2000 },
};
export const VEHICLE_ORDER = ['sedan', 'taxi', 'van', 'truck', 'sports', 'cruiser'];

/** 5 weapon tiers: name, damage, range, rate, ammo, price, rank needed (0 STREET, 1 FIXER, 2 SHOT CALLER). */
export const WEAPONS = [
  { name: 'Fists', damage: 25, range: 64,  rate: 0.45, ammoMax: Infinity, bulletSpeed: 0,    spread: 0,    ammo: null,          price: 0,    rank: 0 },
  { name: '.38',   damage: 34, range: 430, rate: 0.28, ammoMax: 24,  bulletSpeed: 920,  spread: 0.03, ammo: 'ammoPistol',  price: 0,    rank: 0 },
  { name: 'SMG',   damage: 16, range: 390, rate: 0.09, ammoMax: 120, bulletSpeed: 980,  spread: 0.09, ammo: 'ammoSmg',     price: 0,    rank: 0 },
  { name: '12G',   damage: 55, range: 300, rate: 0.8,  ammoMax: 24,  bulletSpeed: 800,  spread: 0.18, ammo: 'ammoShotgun', price: 600,  rank: 1 },
  { name: 'AR-9',  damage: 22, range: 500, rate: 0.07, ammoMax: 180, bulletSpeed: 1100, spread: 0.06, ammo: 'ammoAr',      price: 1500, rank: 2 },
];

export const RADIO = [
  { name: 'Synthwave Drive', bpm: 112, scale: [0, 3, 5, 7, 10], base: 110, tracks: ['Neon Tideline', 'Midnight Cruise', 'Sunset Overdrive'] },
  { name: 'Lo-Fi Night',     bpm: 76,  scale: [0, 3, 5, 7, 10], base: 98,  tracks: ['Harbor Rain', 'Slow Tide', 'Porch Light'] },
  { name: 'Rock Riff',       bpm: 140, scale: [0, 2, 3, 7, 9],  base: 82,  tracks: ['Gasoline Heart', 'Redline', 'Bay City Burn'] },
];

export const GARAGE = { x: 2800, y: 400, radius: 90 };
export const UPGRADE_COSTS = [200, 400, 800];
export const REPAIR_CASH_PER_HP = 2;

export const POLICE = {
  patrolCount: 2,
  maxCruisers: 6,
  viewDist: 650,
  chaseSpeed: 560,
  ramDamage: 12,
  bustTime: 1.5,
  bustTimeFoot: 0.8,
  roadblockAt: 3,
  /** Wanted level lost per second while fully hidden. */
  decayPerSec: 0.25,
};

export const TRAFFIC_COUNT = 16;
export const PED_COUNT = 40;
export const POOL_SIZE = 256;

export const COMBO = { max: 5, window: 3.0, nearMissDist: 56, nearMissCash: 10 };

/** The 10 story chapters: name, subtitle, start time of day (0..1), objective. */
export const CHAPTERS = [
  { name: 'Cahaya Pertama', sub: 'First Light',  time: 0.06, type: 'reach',   brief: 'Reach the harbor marker', target: { x: 1600, y: 1980 } },
  { name: 'Lintasan Pelabuhan', sub: 'Harbor Run', time: 0.30, type: 'collect', brief: 'Collect 6 cash drops', collect: 6, target: { x: 1600, y: 1980 } },
  { name: 'Giliran Malam', sub: 'Night Shift',   time: 0.78, type: 'escape',  brief: 'Escape the heat — reach the dock', target: { x: 2200, y: 1980 }, startWanted: 2 },
  { name: 'Brankas', sub: 'The Vault',           time: 0.55, type: 'vault',   brief: 'Grab 4 cash, then reach the vault', collect: 4, target: { x: 400, y: 400 } },
  { name: 'Gelombang Panas', sub: 'Heat Wave',   time: 0.82, type: 'deliver', brief: 'Deliver the package across town', target: { x: 2800, y: 1900 }, timeLimit: 75 },
  { name: 'Raja Teluk', sub: 'King of the Bay',  time: 0.92, type: 'finale',  brief: 'Reach the bay at wanted 5', target: { x: 1600, y: 2050 }, startWanted: 5 },
  { name: 'Jembatan Emas', sub: 'Golden Bridge', time: 0.35, type: 'deliver', brief: 'Smuggle the gold across the bridge', target: { x: 2800, y: 400 }, timeLimit: 90 },
  { name: 'Arsip Hitam', sub: 'Black Ledger',    time: 0.55, type: 'collect', brief: 'Collect 8 ledger coins', collect: 8, target: { x: 400, y: 1400 } },
  { name: 'Jalan Keluar', sub: 'The Way Out',    time: 0.65, type: 'escape',  brief: 'Break the cordon — reach the marina', target: { x: 400, y: 1900 }, startWanted: 3 },
  { name: 'Mahkota Aurelia', sub: 'Crown of Aurelia', time: 0.95, type: 'finale', brief: 'Hold the crown at wanted 5 — reach the bay', target: { x: 1600, y: 2050 }, startWanted: 5 },
];

/** One briefing line per chapter, spoken by DARA, the fixer who runs the crew. */
export const DIALOG = [
  { speaker: 'DARA', line: 'Welcome to Aurelia Bay. Keep the engine running — this city never sleeps.' },
  { speaker: 'DARA', line: 'Six drops on the harbor road. Grab them before APD sweeps the block.' },
  { speaker: 'DARA', line: 'Night shift. The heat is on — reach the dock and vanish.' },
  { speaker: 'DARA', line: 'Four stacks, then the vault. Do not get cute with the alarm.' },
  { speaker: 'DARA', line: 'Package across town, seventy-five seconds. Drive like you mean it.' },
  { speaker: 'DARA', line: 'Five stars and the whole bay watching. Make them remember your name.' },
  { speaker: 'DARA', line: 'Gold across the bridge. Ninety seconds — the toll is your tail.' },
  { speaker: 'DARA', line: 'The black ledger buys the harbor. Eight coins, no witnesses.' },
  { speaker: 'DARA', line: 'Three stars and closing. The marina road is clear — take it.' },
  { speaker: 'DARA', line: 'The crown is yours to take. Five stars, one bay, no turning back.' },
];

/** The crew: three named members with an active ability each (keys 4/5/6). */
export const CREW = [
  { id: 'driver',   name: 'Raka',  role: 'Driver',   ability: 'Clean Plate', key: '4', cooldown: 45, desc: 'Swap plates — wanted drops 2 levels' },
  { id: 'mechanic', name: 'Sinta', role: 'Mechanic', ability: 'Field Fix',   key: '5', cooldown: 60, desc: 'Repair the car to full, on the spot' },
  { id: 'lookout',  name: 'Bimo',  role: 'Lookout',  ability: 'Eagle Eye',   key: '6', cooldown: 30, desc: 'Mark police and cash on the minimap' },
];
export const CREW_ORDER = ['driver', 'mechanic', 'lookout'];

/** Respect ranks: respect grows from cash pickups (+10), chapters (+100) and side missions (+50). */
export const RANKS = [
  { name: 'STREET', at: 0 },
  { name: 'FIXER', at: 150 },
  { name: 'SHOT CALLER', at: 400 },
];
export const RESPECT_MAX = 999;
/** Rank index (0..2) for a respect value. */
export function rankFor(respect) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i += 1) if (respect >= RANKS[i].at) r = i;
  return r;
}
/** Respect still needed for the next rank (0 at the top rank). */
export function respectToNext(respect) {
  for (let i = 0; i < RANKS.length; i += 1) {
    if (respect < RANKS[i].at) return RANKS[i].at - respect;
  }
  return 0;
}

/** The five districts of Aurelia Bay, by world rectangle. */
export const DISTRICTS = [
  { name: 'OLD TOWN',  x0: 0,    y0: 0,   x1: 1000, y1: 900 },
  { name: 'DOWNTOWN',  x0: 1000, y0: 0,   x1: 2000, y1: 900 },
  { name: 'MARINA',    x0: 2000, y0: 0,   x1: 3200, y1: 900 },
  { name: 'HARBOR',    x0: 0,    y0: 900, x1: 1600, y1: 2040 },
  { name: 'BAYFRONT',  x0: 1600, y0: 900, x1: 3200, y1: 2040 },
];
/** District index for a world position. */
export function districtIndexAt(x, y) {
  for (let i = 0; i < DISTRICTS.length; i += 1) {
    const d = DISTRICTS[i];
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return i;
  }
  return 3;
}
/** Standing label for a 0..100 standing value. */
export function standingLabel(value) {
  if (value < 30) return 'HOSTILE';
  if (value < 55) return 'NEUTRAL';
  if (value < 80) return 'FRIENDLY';
  return 'ALLY';
}

export const SIDE_TYPES = {
  taxi:      { label: 'Taxi Fare',    reward: 150, time: 45 },
  courier:   { label: 'Courier',      reward: 200, time: 60 },
  timetrial: { label: 'Time Trial',   reward: 250, time: 50 },
};
export const SIDE_ORDER = ['taxi', 'courier', 'timetrial'];

export const PALETTE = {
  backdrop: '#14100c',
  water: '#2a6a7a',
  sand: '#e0c08a',
  asphalt: '#4a4038',
  lane: '#f0e6c8',
  sidewalk: '#a08b6d',
  building: ['#8a6a5a', '#9a7a4a', '#7a5a4a', '#a05a4a', '#8a7a3a', '#b08a5a'],
  ground: '#6a5a38',
  plaza: '#b09a7a',
  dock: '#8a6a42',
  text: '#f5efe2',
  muted: '#c8b898',
  panel: 'rgba(28, 20, 12, 0.88)',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
