// Renders the 4 screenshots from shots.json into screenshots/ (repo root, where
// main.ts picks them up for the dossier). Spawns the dev server, opens each
// ?shot= scene in headless Chromium, waits for window.__shotReady, and screenshots
// at 1280x720. Fails when a shot is over 256 KiB or any console/page error appears.
// Run: node tools/capture-shots.mjs — exits 0 when all 4 shots are clean.

import { spawn } from 'node:child_process';
import { readdir, rm, stat, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '/home/hatch/workspace/makefun/node_modules/playwright-core/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shotsDir = join(root, 'screenshots');
const shots = JSON.parse(await readFile(join(root, 'shots.json'), 'utf8'));
const PORT = 8080;
const MAX_BYTES = 262144;

function findHeadlessShell() {
  const base = join(process.env.HOME || '/home/hatch', '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium_headless_shell-')) continue;
    const bin = join(base, dir, 'chrome-linux', 'headless_shell');
    if (existsSync(bin)) return bin;
  }
  return null;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let failures = 0;

async function main() {
  // Clean out the starter screenshots so the dossier carries exactly these 4.
  for (const f of await readdir(shotsDir)) {
    await rm(join(shotsDir, f));
    console.log(`removed old ${f}`);
  }

  const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => {
    serverLog += d;
  });
  server.stderr.on('data', (d) => {
    serverLog += d;
  });

  try {
    if (!(await waitForServer(`http://127.0.0.1:${PORT}/`))) {
      throw new Error(`server did not come up:\n${serverLog}`);
    }
    const executablePath = findHeadlessShell();
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    try {
      for (const shot of shots) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        const errors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
        });
        page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
        const url = `http://127.0.0.1:${PORT}/${shot.query}`;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
        const outPath = join(shotsDir, shot.name);
        await page.screenshot({ path: outPath, type: 'jpeg', quality: 80 });
        const size = (await stat(outPath)).size;
        const over = size > MAX_BYTES;
        if (over || errors.length > 0) failures += 1;
        console.log(`${shot.name}: ${size} bytes${over ? ' OVER 256 KiB LIMIT' : ''}, errors: ${errors.length}${errors.length > 0 ? ` (${errors.join(' | ')})` : ''}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

await main();
console.log(failures === 0 ? 'all 4 shots clean' : `${failures} shot(s) failed`);
process.exit(failures === 0 ? 0 : 1);
