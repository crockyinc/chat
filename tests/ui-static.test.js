/**
 * The failure mode users actually hit: the UI is served by a static host
 * (Cloudflare Pages/Workers assets, GitHub Pages, `python -m http.server`) while
 * the Node backend is not reachable. Before this suite existed, tapping "Enter
 * chat" produced the bare message "Request failed (405)" — technically true,
 * completely unhelpful.
 *
 * These tests boot the *real* Pages bundle against a fake static host that
 * imitates two behaviours Wrangler/Pages actually exhibit:
 *
 *   'reject'   POST → 405 Method Not Allowed, unknown GETs → 404   (Workers assets)
 *   'spa'      everything → index.html with 200                    (SPA fallback)
 *
 * and assert the join screen explains the situation instead of leaking a status
 * code. Requires `npm run build:pages` first (see `npm run verify`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 8000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(50);
  }
}

/** A server that serves the static bundle and nothing else — no chat API. */
function startStaticHost(mode) {
  const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(DIST, 'css/app.css'), 'utf8');
  const js = fs.readFileSync(path.join(DIST, 'js/app.js'), 'utf8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Length': '0' });
      return res.end();
    }
    if (url.pathname === '/css/app.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(css);
    }
    if (url.pathname === '/js/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(js);
    }
    if (url.pathname === '/' || isApi) {
      // 'reject' mimics Workers static assets answering an unknown API route
      // with 404; 'spa' mimics a fallback that returns the shell with 200.
      if (isApi && mode === 'reject') {
        res.writeHead(404, { 'Content-Length': '0' });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(indexHtml);
    }
    res.writeHead(404, { 'Content-Length': '0' });
    return res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

/**
 * Boots the Pages bundle against `origin` and waits for the join screen to
 * settle (boot() probes /api/health and then /api/auth/room).
 */
async function bootStaticPage(origin, pageUrl = `${origin}/`) {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  virtualConsole.on('error', (message) => errors.push(message));

  const dom = new JSDOM(html, {
    url: pageUrl,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollTo = function scrollTo() {};

  // jsdom has no fetch; forward to the fake static host (no cookies to replay,
  // because there is no backend issuing them).
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const absolute = url.startsWith('http') ? url : `${origin}${url}`;
    const { credentials, ...rest } = init;
    void credentials;
    return fetch(absolute, rest);
  };

  await waitFor(() => window.lm && window.document.getElementById('joinError'), { label: 'app boot' });
  // boot(): probe (/api/health) → loadRoom (/api/auth/room) → render message.
  await waitFor(
    () => !window.document.getElementById('joinError').classList.contains('hidden'),
    { label: 'join screen diagnosis' },
  );
  return { dom, window, document: window.document, errors };
}

before(() => {
  assert.ok(
    fs.existsSync(path.join(DIST, 'index.html')),
    'Run `npm run build:pages` before this suite',
  );
});

for (const mode of ['reject', 'spa']) {
  test(`a static host without a backend explains itself (${mode} behaviour)`, async (t) => {
    const { server, origin } = await startStaticHost(mode);
    const page = await bootStaticPage(origin);
    t.after(() => {
      page.window.close();
      server.close();
    });

    const errorText = page.document.getElementById('joinError').textContent.trim();
    const hintText = page.document.getElementById('joinHint').textContent.trim();

    // The old, useless message must be gone.
    assert.doesNotMatch(errorText, /Request failed \(40\d\)/, 'no bare status codes');
    assert.doesNotMatch(errorText, /reading 'name'/, 'no internal TypeErrors');

    assert.match(errorText, /static host/i, `explains the cause, got: "${errorText}"`);
    assert.match(hintText, /\?backend=/, `tells the user how to point at a backend, got: "${hintText}"`);

    // "Enter chat" must not pretend it can work.
    assert.equal(page.document.getElementById('joinSubmit').disabled, true, 'join button is disabled');

    const fatal = page.errors.filter(
      (error) => !/Not implemented: .*(scrollTo|alert)/.test(String(error?.message || error)),
    );
    assert.deepEqual(fatal.map((e) => String(e?.message || e)), [], 'no uncaught client errors');
  });
}

test('submitting the join form on a static host does not throw a bare 405', async (t) => {
  const { server, origin } = await startStaticHost('reject');
  const page = await bootStaticPage(origin);
  t.after(() => {
    page.window.close();
    server.close();
  });

  page.document.getElementById('joinName').value = 'Naeem';
  page.document
    .getElementById('joinForm')
    .dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));

  await sleep(600);
  const errorText = page.document.getElementById('joinError').textContent.trim();
  assert.doesNotMatch(errorText, /^Request failed \(\d+\)$/, `actionable message, got: "${errorText}"`);
  assert.match(errorText, /static host|backend/i);
  // Still on the join screen, still not joined.
  assert.equal(page.document.getElementById('joinModal').classList.contains('hidden'), false);
});

test('a ?backend= pointing at the static host itself is reported, not silently joined', async (t) => {
  const { server, origin } = await startStaticHost('reject');
  // Someone guesses wrong: the query parameter points back at the static host.
  const page = await bootStaticPage(origin, `${origin}/?backend=${encodeURIComponent(origin)}`);
  t.after(() => {
    page.window.close();
    server.close();
  });

  const errorText = page.document.getElementById('joinError').textContent.trim();
  assert.match(errorText, /static host|not the chat API|backend/i, `got: "${errorText}"`);
  assert.equal(page.document.getElementById('joinSubmit').disabled, true);
  // The configured-but-wrong server address must be visible, not just logged,
  // so the user can see *what* to fix.
  await waitFor(
    () => /Server:/.test(page.document.getElementById('backendNote').textContent),
    { label: 'backend note showing the configured server' },
  );
});

test('the built shell is relocatable and points nowhere until configured', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.match(html, /href="\.\/css\/app\.css"/);
  assert.match(html, /src="\.\/js\/app\.js"/);
  assert.doesNotMatch(html, /href="\/css\/app\.css"/, 'no root-absolute asset paths');
  // No backend baked in unless LAN_CHAT_BACKEND was set for the build.
  if (!process.env.LAN_CHAT_BACKEND) {
    assert.doesNotMatch(html, /LAN_CHAT_BACKEND/, 'no stale backend baked into the shell');
  }
});
