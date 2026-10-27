#!/usr/bin/env node
/**
 * Browser-level smoke test for Scratchpad against a disposable PocketBase.
 *
 * What it does, end to end:
 *   1. Downloads PocketBase (cached in node_modules/.cache) into a temp dir.
 *   2. Starts a throwaway PocketBase on 127.0.0.1:8099 with an isolated
 *      superuser and a `notes` collection whose API rules scope every record
 *      to its owner (`user = @request.auth.id`).
 *   3. Starts the Vite dev server on 127.0.0.1:7100 with
 *      VITE_POCKETBASE_URL pointing at the test instance.
 *   4. Drives headless Chrome over the Chrome DevTools Protocol (no extra
 *      npm dependencies; uses Node's built-in WebSocket and fetch):
 *      sign-up/sign-in, account isolation in both directions, forced
 *      offline queueing, reconnect sync, and server-side ownership checks.
 *   5. Tears everything down and deletes the temp data.
 *
 * Requirements: Node.js 24, and Google Chrome or Microsoft Edge installed
 * (override the browser with CHROME_PATH=/path/to/browser).
 *
 * Usage: npm run smoke
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const APP_PORT = Number(process.env.SMOKE_APP_PORT ?? 7100);
const PB_PORT = Number(process.env.SMOKE_PB_PORT ?? 8099);
const CDP_PORT = Number(process.env.SMOKE_CDP_PORT ?? 9222);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PB_URL = `http://127.0.0.1:${PB_PORT}`;

const PB_VERSION = '0.40.6';
const PB_CACHE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'scratchpad-smoke');
const RUNTIME_DIR = path.join(os.tmpdir(), `scratchpad-smoke-${process.pid}`);
const PB_DATA_DIR = path.join(RUNTIME_DIR, 'pb-data');
const CHROME_PROFILE_DIR = path.join(RUNTIME_DIR, 'chrome-profile');

const SU_EMAIL = 'scratchpad-smoke@test.local';
const SU_PASSWORD = 'SmokeTest-Password-2026';

const USER_A = { email: 'smoke-user-a@example.test', password: 'SmokePassword-A-2026' };
const USER_B = { email: 'smoke-user-b@example.test', password: 'SmokePassword-B-2026' };
const NOTE_A = { title: 'A private title', body: 'Private content for account A' };
const NOTE_B = { title: 'B private title', body: 'Private content for account B' };
const NOTE_OFFLINE = {
  title: 'A offline queued title',
  body: 'Queued while PocketBase was disconnected',
};

// ---------------------------------------------------------------------------
// Small utilities

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = false;
function pass(message) {
  console.log(`PASS: ${message}`);
}
function fail(message) {
  failed = true;
  throw new Error(`FAIL: ${message}`);
}
function stage(message) {
  console.log(`\n== ${message} ==`);
}

async function poll(label, fn, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out (${timeoutMs}ms) waiting for: ${label}${lastError ? ` — last error: ${lastError.message}` : ''}`);
}

async function assertPortFree(port, what) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    fail(`${what} port ${port} is already in use — free it and retry`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  }
}

/** Keep the tail of a child's output for diagnostics. */
function logTail(child, label, max = 64 * 1024) {
  let buf = '';
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    stream.on('data', (chunk) => {
      buf = (buf + chunk.toString()).slice(-max);
    });
  }
  return () => buf;
}

function spawnChild(command, args, { env, cwd, detached } = {}) {
  const child = spawn(command, args, {
    cwd: cwd ?? REPO_ROOT,
    env: { ...process.env, ...(env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: detached ?? process.platform !== 'win32',
  });
  const tail = logTail(child, command);
  return { child, tail };
}

function killTree(handle, label) {
  if (!handle) return;
  const { child } = handle;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/F', '/T'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// PocketBase: binary, server, superuser, collection

function pbArchiveUrl() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'win32') {
    return `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_windows_${arch}.zip`;
  }
  if (process.platform === 'darwin') {
    return `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_darwin_${arch}.zip`;
  }
  return `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${arch}.tar.gz`;
}

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fail(`download failed: HTTP ${res.status} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  return bytes.length;
}

function extractArchive(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archive.endsWith('.zip') && process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Force '${archive}' '${destDir}'`],
      { stdio: 'inherit' },
    );
  } else if (archive.endsWith('.zip')) {
    try {
      execFileSync('unzip', ['-o', archive, '-d', destDir], { stdio: 'inherit' });
    } catch {
      execFileSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
    }
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'inherit' });
  }
}

async function ensurePocketBaseBinary() {
  const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
  const binaryPath = path.join(PB_CACHE_DIR, binaryName);
  if (fs.existsSync(binaryPath)) return binaryPath;
  const url = pbArchiveUrl();
  const archive = path.join(RUNTIME_DIR, url.split('/').pop());
  await download(url, archive);
  extractArchive(archive, PB_CACHE_DIR);
  if (process.platform !== 'win32') fs.chmodSync(binaryPath, 0o755);
  if (!fs.existsSync(binaryPath)) fail(`PocketBase binary not found after extract: ${binaryPath}`);
  return binaryPath;
}

async function pbApi(method, apiPath, { token, body } = {}) {
  const res = await fetch(`${PB_URL}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PocketBase ${method} ${apiPath} -> HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function waitForPb() {
  await poll(`PocketBase health on ${PB_PORT}`, async () => {
    const res = await fetch(`${PB_URL}/api/health`);
    return res.ok;
  }, { timeoutMs: 20000 });
}

function createSuperuser(pbBinary) {
  execFileSync(pbBinary, ['superuser', 'create', SU_EMAIL, SU_PASSWORD, `--dir=${PB_DATA_DIR}`], {
    stdio: 'inherit',
  });
}

async function createNotesCollection(token) {
  const systemUsers = await pbApi('GET', '/api/collections/_pb_users_auth_', { token });
  await pbApi('POST', '/api/collections', {
    token,
    body: {
      name: 'notes',
      type: 'base',
      fields: [
        { name: 'title', type: 'text', presentable: true },
        { name: 'body', type: 'text' },
        { name: 'color', type: 'text' },
        { name: 'pinned', type: 'bool' },
        { name: 'archived', type: 'bool' },
        { name: 'deleted', type: 'bool' },
        { name: 'client_id', type: 'text', presentable: true },
        { name: 'updated_at', type: 'number' },
        { name: 'created_at', type: 'number' },
        {
          name: 'user',
          type: 'relation',
          collectionId: systemUsers.id,
          maxSelect: 1,
        },
      ],
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: 'user = @request.auth.id',
      updateRule: 'user = @request.auth.id',
      deleteRule: 'user = @request.auth.id',
    },
  });
  console.log('Created isolated notes collection with user-scoped API rules.');
}

// ---------------------------------------------------------------------------
// Chrome discovery

function findChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    candidates.push(
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try {
        const found = execFileSync('sh', ['-c', `command -v ${name}`], {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim();
        if (found) candidates.push(found);
      } catch {
        // not on PATH
      }
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(
    'No Chrome or Edge installation found. Install Google Chrome or set CHROME_PATH to a browser binary.',
  );
}

// ---------------------------------------------------------------------------
// Minimal CDP client (browser endpoint, flat sessions)

class Cdp {
  static async connect(wsUrl) {
    const cdp = new Cdp(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${wsUrl}`)), 15000);
      cdp.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      cdp.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP connection error: ${event.message ?? wsUrl}`));
      });
    });
    return cdp;
  }

  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`CDP ${message.error.message ?? JSON.stringify(message.error)}`));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async newPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    return sessionId;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url }, this.sessionId);
  }

  async viewport(width, height) {
    await this.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      this.sessionId,
    );
  }

  async eval(expression) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? JSON.stringify(result.exceptionDetails);
      throw new Error(`page eval failed: ${String(detail).slice(0, 300)}`);
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Browser interaction helpers (React-aware)

async function pageText(cdp) {
  return (await cdp.eval('document.body.innerText')) ?? '';
}

async function requireText(cdp, text) {
  const body = await pageText(cdp);
  if (body.includes(text)) return pass(`found "${text}"`);
  fail(`missing text: "${text}" — page text was: ${body.slice(0, 500)}`);
}

async function forbidText(cdp, text) {
  const body = await pageText(cdp);
  if (body.includes(text)) {
    fail(`unexpected text: "${text}" — page text was: ${body.slice(0, 500)}`);
  }
  pass(`did not find "${text}"`);
}

async function waitForText(cdp, text, timeoutMs = 15000) {
  await poll(`text "${text}"`, async () => {
    const body = await pageText(cdp);
    return body.includes(text);
  }, { timeoutMs });
  pass(`found "${text}"`);
}

async function clickButton(cdp, label) {
  const clicked = await cdp.eval(`
    (() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((element) => element.textContent.includes(${JSON.stringify(label)}));
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
  if (!clicked) fail(`button not found: "${label}"`);
}

async function setField(cdp, selector, value) {
  const result = await cdp.eval(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'MISSING';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    })()
  `);
  if (result !== 'OK') fail(`could not set field: ${selector} (${result})`);
}

async function submitAuthForm(cdp) {
  const ok = await cdp.eval(`
    (() => {
      const form = document.querySelector('form');
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()
  `);
  if (!ok) fail('auth form not found');
}

async function signUp(cdp, { email, password }) {
  await clickButton(cdp, 'Sign Up');
  await sleep(500);
  await setField(cdp, "input[type='email']", email);
  await setField(cdp, "input[type='password']", password);
  await sleep(500);
  await submitAuthForm(cdp);
  await waitForText(cdp, 'New Note', 20000);
}

async function signIn(cdp, { email, password }) {
  await setField(cdp, "input[type='email']", email);
  await setField(cdp, "input[type='password']", password);
  await sleep(500);
  await submitAuthForm(cdp);
  await waitForText(cdp, 'New Note', 20000);
}

async function signOut(cdp) {
  await cdp.eval(`document.querySelector("button[title='Sign out']").click()`);
  await waitForText(cdp, 'Sign In', 10000);
}

async function openNoteEditor(cdp) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await clickButton(cdp, 'New Note');
    await sleep(800);
    const open = await cdp.eval(`document.querySelectorAll('textarea').length > 0`);
    if (open) return;
  }
  fail('note editor did not open after 5 attempts');
}

async function createNote(cdp, { title, body }) {
  await openNoteEditor(cdp);
  await setField(cdp, "textarea[placeholder='Title']", title);
  await setField(cdp, "textarea[placeholder='Start writing...']", body);
}

async function createSyncedNote(cdp, note) {
  await createNote(cdp, note);
  await waitForText(cdp, note.title, 10000);
  // The badge alone is not proof of a completed push: it can still show a
  // stale "Synced" from before the edit. The definitive check is that the
  // record reached the server with the expected content.
  await waitForServerRecord(note);
  await waitForText(cdp, 'Synced', 20000);
}

// ---------------------------------------------------------------------------
// Server-side verification helpers

let superuserToken = null;

async function listServerRecords() {
  const data = await pbApi('GET', '/api/collections/notes/records?perPage=100&expand=user', {
    token: superuserToken,
  });
  return (data.items ?? []).map((record) => ({
    user: record.expand?.user?.email ?? '?',
    clientId: record.client_id,
    title: record.title,
    body: record.body,
    updatedAt: record.updated_at,
  }));
}

async function waitForServerRecord(note, timeoutMs = 20000) {
  await poll(`server record for "${note.title}"`, async () => {
    const records = await listServerRecords();
    return records.some(
      (record) => record.title === note.title && record.body === note.body,
    );
  }, { timeoutMs });
  pass(`server received "${note.title}"`);
}

const SMOKE_DEBUG = process.env.SMOKE_DEBUG === '1';

async function dumpIdb(cdp, label) {
  if (!SMOKE_DEBUG) return;
  const notes = await cdp.eval(`
    (async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('scratchpad');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').getAll();
        req.onsuccess = () => resolve(req.result.map((n) => ({
          owner: n.ownerId, title: n.title, body: n.body,
          dirty: n.dirty, rev: n.localRevision, remoteId: n.remoteId,
        })));
        req.onerror = () => reject(req.error);
      });
    })()
  `);
  console.log(`[debug] IDB after ${label}: ${JSON.stringify(notes)}`);
}

// ---------------------------------------------------------------------------
// Lifecycle handles for cleanup

let viteHandle = null;
let chromeHandle = null;
let pbHandle = null;
let cdp = null;
let pbBinary = null;

async function startVite() {
  await assertPortFree(APP_PORT, 'App');
  viteHandle = spawnChild(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(APP_PORT), '--strictPort'],
    { env: { VITE_POCKETBASE_URL: PB_URL } },
  );
  await poll(`Vite dev server on ${APP_PORT}`, async () => {
    const res = await fetch(APP_URL);
    if (!res.ok) return false;
    const html = await res.text();
    return html.includes('Scratchpad');
  }, { timeoutMs: 30000 });
  console.log(`Vite dev server ready at ${APP_URL}`);
}

async function startChrome() {
  await assertPortFree(CDP_PORT, 'Chrome CDP');
  const chromePath = findChrome();
  fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
  chromeHandle = spawnChild(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE_DIR}`,
    '--no-first-run',
    '--disable-gpu',
    'about:blank',
  ]);
  const version = await poll(`Chrome CDP on ${CDP_PORT}`, async () => {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return res.ok ? res.json() : false;
  }, { timeoutMs: 20000 });
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  await cdp.newPage();
  await cdp.viewport(1280, 900);
  console.log(`Headless Chrome ready (pid ${chromeHandle.child.pid})`);
}

function startPocketBase() {
  pbHandle = spawnChild(pbBinary, ['serve', '--dir', PB_DATA_DIR, '--http', `127.0.0.1:${PB_PORT}`], {
    cwd: RUNTIME_DIR,
  });
}

function cleanup() {
  console.log('\nCleaning up smoke-test processes and data...');
  cdp?.close();
  killTree(chromeHandle, 'chrome');
  killTree(viteHandle, 'vite');
  killTree(pbHandle, 'pocketbase');
  try {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

// ---------------------------------------------------------------------------
// Main flow

async function main() {
  stage('Preparing disposable PocketBase');
  fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
  fs.mkdirSync(PB_DATA_DIR, { recursive: true });
  pbBinary = await ensurePocketBaseBinary();
  await assertPortFree(PB_PORT, 'PocketBase');
  createSuperuser(pbBinary);
  startPocketBase();
  await waitForPb();
  console.log(`PocketBase ${PB_VERSION} ready at ${PB_URL}`);
  const { token } = await pbApi('POST', '/api/collections/_superusers/auth-with-password', {
    body: { identity: SU_EMAIL, password: SU_PASSWORD },
  });
  superuserToken = token;
  await createNotesCollection(token);

  stage('Starting Vite dev server against the test instance');
  await startVite();

  stage('Starting headless Chrome');
  await startChrome();

  stage('Opening the app');
  await cdp.navigate(APP_URL);
  await waitForText(cdp, 'Sign In', 40000);

  stage('Creating and syncing account A');
  await signUp(cdp, USER_A);
  await createSyncedNote(cdp, NOTE_A);
  await dumpIdb(cdp, 'A note created');
  await signOut(cdp);
  await dumpIdb(cdp, 'A signed out');

  stage('Creating account B and verifying account isolation');
  await signUp(cdp, USER_B);
  await forbidText(cdp, NOTE_A.title);
  await forbidText(cdp, NOTE_A.body);
  await createSyncedNote(cdp, NOTE_B);
  await dumpIdb(cdp, 'B note created');
  await signOut(cdp);
  await dumpIdb(cdp, 'B signed out');

  stage('Returning to account A and verifying reverse isolation');
  await signIn(cdp, USER_A);
  await requireText(cdp, NOTE_A.title);
  await forbidText(cdp, NOTE_B.title);
  await forbidText(cdp, NOTE_B.body);

  stage('Disconnecting PocketBase and queueing an offline edit');
  killTree(pbHandle, 'pocketbase');
  pbHandle = null;
  await cdp.eval(`window.dispatchEvent(new Event('offline'))`);
  await sleep(500);
  await createNote(cdp, NOTE_OFFLINE);
  await waitForText(cdp, NOTE_OFFLINE.title, 10000);
  await waitForText(cdp, 'Offline', 10000);
  await requireText(cdp, NOTE_A.title);

  stage('Reconnecting PocketBase and syncing the queued edit');
  startPocketBase();
  await waitForPb();
  await cdp.eval(`window.dispatchEvent(new Event('online'))`);
  await waitForText(cdp, NOTE_OFFLINE.title, 10000);
  await waitForText(cdp, 'Synced', 30000);

  stage('Verifying server records and second-account isolation');
  const summary = await listServerRecords();
  console.log(JSON.stringify(summary, null, 2));
  for (const [user, note] of [
    [USER_A.email, NOTE_A],
    [USER_B.email, NOTE_B],
    [USER_A.email, NOTE_OFFLINE],
  ]) {
    const found = summary.some(
      (record) => record.user === user && record.title === note.title && record.body === note.body,
    );
    if (!found) fail(`server is missing ${user}'s note "${note.title}"`);
    pass(`server record verified: ${user} / "${note.title}"`);
  }
  for (const record of summary) {
    if (record.user.startsWith('smoke-user-') && record.title === '') {
      fail(`server has an empty note record for ${record.user} (clientId ${record.clientId})`);
    }
  }
  pass('no empty note records on the server');

  await signOut(cdp);
  await signIn(cdp, USER_B);
  await requireText(cdp, NOTE_B.title);
  await forbidText(cdp, NOTE_OFFLINE.title);
  await forbidText(cdp, NOTE_A.title);

  console.log('\nBrowser smoke test completed successfully.');
}

try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\n${err instanceof Error ? err.stack ?? err.message : err}`);
  if (viteHandle) console.error(`\n--- Vite log tail ---\n${viteHandle.tail()}`);
} finally {
  cleanup();
}

process.exit(failed ? 1 : 0);
