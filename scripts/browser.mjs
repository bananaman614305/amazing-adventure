// Shared headless-Chrome harness for the browser tests.
//
// Uses the host Chrome at $CHROME_PATH (default /opt/google/chrome/chrome) with
// a private temporary profile, --no-sandbox and --disable-dev-shm-usage, and
// binds a local game server to 127.0.0.1 on a free port.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const ROOT = resolve(import.meta.dirname, '..');

/** Asks the OS for a free port by binding port 0, then releasing it. */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/** Starts the game server on 127.0.0.1 at a free port. */
export async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 10000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running at')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
  return {
    base,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((done) => child.once('exit', done));
    }
  };
}

/**
 * Launches headless Chrome with a private temp profile.
 * `puppeteer-core` is resolved at runtime so the game itself has no runtime
 * dependency and the test can run from any checkout that installed devDeps.
 */
export async function launchBrowser() {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer-core')).default;
  } catch {
    throw new Error('puppeteer-core is not installed. Run `npm install` first.');
  }
  const userDataDir = await mkdtemp(join(tmpdir(), 'amazing-adventure-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome',
    headless: true,
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-background-networking',
      '--disable-component-update',
      '--no-first-run'
    ]
  });
  return {
    browser,
    async close() {
      await browser.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
}

/**
 * Where screenshots go.
 *
 * By default a test run writes to a throwaway directory. That matters because
 * the committed `artifacts/*.png` are evidence for a pull request: re-running a
 * test must never dirty the working tree, or a clean-tree publication check
 * fails for no gameplay reason. Pass `RECORD_ARTIFACTS=1` (or an explicit
 * SCREENSHOT_DIR) to refresh the committed evidence on purpose.
 */
export async function screenshotDir() {
  if (process.env.SCREENSHOT_DIR) {
    const dir = resolve(process.env.SCREENSHOT_DIR);
    await mkdir(dir, { recursive: true });
    return dir;
  }
  if (process.env.RECORD_ARTIFACTS === '1') {
    const dir = resolve(ROOT, 'artifacts');
    await mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = await mkdtemp(join(tmpdir(), 'amazing-adventure-shots-'));
  return dir;
}

/** A tiny assertion collector so every check reports PASS/FAIL explicitly. */
export function createChecks() {
  const results = [];
  const errors = [];
  return {
    results,
    errors,
    check(name, condition, detail = '') {
      results.push({ name, ok: Boolean(condition), detail });
      return Boolean(condition);
    },
    recordError(error) {
      errors.push(String(error));
    },
    get failed() {
      return results.some((r) => !r.ok) || errors.length > 0;
    },
    print() {
      for (const result of results) {
        console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
      }
      console.log(errors.length ? `FAIL console errors: ${JSON.stringify(errors)}` : 'PASS no console errors');
    }
  };
}
