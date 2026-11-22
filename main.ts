// Aurelia Nights VII — gta6-01 round 9 (Node 22, standard library only): an open-world crime
// game in 2D top-down, this directory's game/ folder (plain static files a desktop browser loads
// offline: game/index.html and its ES modules, no library and no network request). Six chapters
// across Aurelia Bay (3200x2400): predictive police AI (patrol, chase, roadblocks at wanted 3+,
// search and decay), a police helicopter at wanted 5, a weapon wheel (hold Q), a garage to buy,
// repair and upgrade vehicles, a 3-station WebAudio radio (V), three side missions (taxi fare,
// courier, time trial), day-night cycle, combo multiplier up to x5, HUD + minimap, deterministic
// seeds (?seed=N, ?shot=start|play|chase|night) and a save file (aurelia-nights-vii.save.v1).
// This program hands the game in: it copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library. Put 3 or 4 PNG or JPEG screenshots in screenshots/ (the first by name is
// the cover) and run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameDir = join(here, 'game');
if (!existsSync(gameDir)) {
  throw new Error(`Aurelia Nights VII: folder game/ tidak ditemukan di ${gameDir} — entry tidak bisa dibangun.`);
}
mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const dossierPath = join(out, 'dossier.json');
writeFileSync(
  dossierPath,
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
console.log(`Aurelia Nights VII: dossier ditulis ke ${dossierPath} (${statSync(dossierPath).size} byte).`);
