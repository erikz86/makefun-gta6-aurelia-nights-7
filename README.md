# Aurelia Nights VII

[![make.fun](https://img.shields.io/badge/make.fun-bounty-7c3aed)](https://make.fun) [![rank](https://img.shields.io/badge/rank-coming_soon-blue)](https://make.fun) [![reward](https://img.shields.io/badge/reward-USDC-green)](https://make.fun)

A 3D open-world crime game set in Aurelia Bay: steal cars, outrun the police, climb the wanted ladder, and finish all 10 story chapters. The world is rendered in perspective 3D — a chase camera, sunset sky, and 3D buildings, cars, and crowds — drawn with a pure pinhole projector on the plain canvas 2D pipeline (no WebGL, no libraries). The camera kicks in on rams and widens at speed.

- 3200x2400 open city with a day/night cycle, sunset golden hour, beach and harbour, traffic and pedestrians.
- Wanted system 1-5 stars, police chases, roadblocks and a police helicopter at wanted 5, its spotlight cone tracking you.
- Weapon wheel (fists, .38, SMG, 12G, AR-9 — tiers bought with cash and rank), garage with car buying/repairs/upgrades, 3 radio stations.
- Crew of 3 with active abilities: Raka (Clean Plate, drops wanted), Sinta (Field Fix, instant repair), Bimo (Eagle Eye, marks police and cash on the minimap) — keys 4/5/6, with cooldowns.
- Respect meter and ranks (STREET → FIXER → SHOT CALLER) that unlock garage upgrade levels and weapon tiers.
- District standing across 5 districts (Old Town, Downtown, Marina, Harbor, Bayfront), raised by missions.
- Story dialog from DARA the fixer, one line per chapter, plus a live APD dispatch feed.
- Side missions: taxi runs, courier deliveries and time trials, each paying cash.
- 10 story chapters (reach, collect, escape, vault, deliver, finale) with a chapter intro card.
- Combo system, save to localStorage, adaptive quality scaling, WebAudio procedural sound.

## Play

Open `game/index.html` in a browser (or serve this folder with `node serve.ts` and open the shown URL).

- **WASD / arrows** — drive or walk
- **E** — enter or exit a car, open the garage at its lot
- **Q** (hold) — weapon wheel; **1-5** — select weapon; **4/5/6** — crew abilities (Raka / Sinta / Bimo); **click** — shoot at the mouse
- **V** — change radio station
- **R** — repair the car (when stopped)
- **Space** — handbrake
- **P / Esc** — pause
- **?shot=chase|onfoot|night|garage|play|start&seed=N** — staged screenshot scenes

## Tests

- `node tools/test-game.mjs` — logic tests (including 6 projection tests for the 3D camera) and a 600-step performance smoke test.
- `node tools/capture-shots.mjs` — renders 4 screenshots into `screenshots/`.
- `MAKEFUN_OUTPUT_DIR=out node main.ts` — builds the submission dossier.

Built for the [make.fun](https://make.fun) GTA 6 bounty by [erikz86](https://github.com/erikz86).
Repo: `makefun-gta6-aurelia-nights-7` · Referral: [a0533dc2](https://make.fun/r/a0533dc2)
