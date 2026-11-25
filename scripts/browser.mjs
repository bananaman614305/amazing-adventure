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
    // SERVE_DIR is passed through so the suite can be pointed at the built preview.
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ...(process.env.SERVE_DIR ? { SERVE_DIR: process.env.SERVE_DIR } : {}),
      ...(process.env.BASE_PATH ? { BASE_PATH: process.env.BASE_PATH } : {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const basePath = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
  const base = `http://127.0.0.1:${port}${basePath}`;
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
      // If the server already exited (a crash, or an early port-bind failure),
      // 'exit' will never fire again and awaiting it hangs the whole run after
      // every check has already passed -- which throws away the results. Guard
      // on the recorded exit code and back SIGTERM with SIGKILL.
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((done) => {
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          done();
        }, 5000);
        child.once('exit', () => { clearTimeout(timer); done(); });
      });
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
      // Same hazard as server.stop(): a browser that already died (or a hung
      // SwiftShader process) must not swallow the collected PASS/FAIL lines.
      try {
        await Promise.race([
          browser.close(),
          new Promise((done) => setTimeout(done, 10000))
        ]);
      } catch { /* the process may already be gone */ }
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
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

/**
 * Waits until the game exposes its API after load or reload.
 *
 * On this software-rendered machine a boot normally takes ~3s, but a busy
 * SwiftShader frame (a full-res evidence capture, an environment-map rebuild)
 * can stretch one rAF callback past any fixed deadline. The old fixed-20s
 * waitForFunction turned that stall into a bare TimeoutError that killed the
 * whole run with every PASS line still buffered — the release browser check
 * died exactly this way after the seventh reload. So: poll on a timer (rAF
 * polling is starved by the very long frames we are waiting out), and if the
 * wait still fails, report WHY — page error, failed request, WebGL context
 * loss — and let the caller's finally close the browser and print the checks
 * collected so far.
 *
 * A page stuck inside one enormous SwiftShader frame cannot answer a poll at
 * all, so a single long deadline is fragile: host CPU contention stretched a
 * measured boot to 157s on a tree that boots in 2.9s idle. This waits in
 * chunks instead — each chunk re-arms the poll, an expired chunk is logged and
 * retried, and only the whole deadline counts as a failure. Chunking also
 * survives the CDP `Runtime.callFunctionOn` protocol timeout that a stalled
 * renderer produces instead of a plain TimeoutError.
 */
export const BOOT_TIMEOUT = 180000;
const BOOT_CHUNK = 30000;

export async function waitForBoot(page, timeout = BOOT_TIMEOUT) {
  const notes = [];
  const onPageError = (error) => notes.push(`page error: ${error.message}`);
  const onReqFail = (request) =>
    notes.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
  const onConsole = (message) => {
    if (message.type() === 'error') notes.push(`console error: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('requestfailed', onReqFail);
  page.on('console', onConsole);
  const started = Date.now();
  try {
    for (;;) {
      const left = timeout - (Date.now() - started);
      if (left <= 0) break;
      try {
        await page.waitForFunction(() => window.amazingAdventure !== undefined,
          { timeout: Math.min(BOOT_CHUNK, left), polling: 500 });
        return;
      } catch (error) {
        const elapsed = Date.now() - started;
        if (elapsed >= timeout) break;
        // Not fatal yet: the renderer is most likely inside one very long
        // frame. Say so once per chunk, so a slow release machine shows up in
        // the log instead of looking like a hang.
        console.log(`waitForBoot: still booting after ${elapsed}ms ` +
          `(${String(error.message || error).split('\n')[0]}) — still waiting`);
      }
    }
    const diag = await page.evaluate(() => ({
      readyState: document.readyState,
      visibility: document.visibilityState,
      contextLost: window.amazingAdventure
        ? window.amazingAdventure.renderer.getContext().isContextLost()
        : 'no api yet'
    })).catch((e) => ({ unavailable: String(e.message || e) }));
    throw new Error(`game did not boot within ${timeout}ms; ` +
      `page=${JSON.stringify(diag)}; events=${JSON.stringify(notes.slice(-8))}`);
  } finally {
    page.off('pageerror', onPageError);
    page.off('requestfailed', onReqFail);
    page.off('console', onConsole);
  }
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
      const passed = results.filter((r) => r.ok).length;
      console.log(`${passed}/${results.length} checks passed`);
    }
  };
}
