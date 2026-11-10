/**
 * Is there actually a chat server on the other end?
 *
 * A static host (Cloudflare Pages / Workers assets, GitHub Pages, `python -m
 * http.server`) happily serves `index.html`, so the app boots and shows the join
 * screen — but every `/api/...` call lands on the static host, which answers
 * `405 Method Not Allowed` with an empty body. Without this check the user sees
 *   "Request failed (405)"
 * and has no idea that what is missing is the backend, not the password.
 *
 * So before the join form is usable we ask `/api/health` who we are talking to.
 */

import { ApiError } from './api.js';
import { apiUrl, backendOrigin, absoluteUrl, isRemoteBackend } from './backend.js';

const PROBE_TIMEOUT_MS = 4000;

/**
 * @returns {Promise<{state: 'ok'|'no-backend'|'unreachable', backend: string, detail: string}>}
 *   `ok`          a real chat server answered
 *   `no-backend`  something static answered instead of our API (405 / HTML / not JSON)
 *   `unreachable` nothing answered at all (server down, wrong URL, CORS blocked)
 */
export async function probeBackend() {
  const backend = backendOrigin();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null;

  try {
    const res = await fetch(apiUrl('/api/health'), {
      method: 'GET',
      credentials: isRemoteBackend() ? 'include' : 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });

    if (res.ok) {
      const type = res.headers.get('content-type') || '';
      if (!type.includes('application/json')) {
        // A static host serving index.html for unknown paths looks like this.
        return { state: 'no-backend', backend, detail: 'the URL answered with a page, not the chat API' };
      }
      const payload = await res.json().catch(() => null);
      if (payload?.ok) return { state: 'ok', backend, detail: '' };
      return { state: 'no-backend', backend, detail: 'the URL answered, but not with the chat API' };
    }

    // 404/405 are the static-host signatures: our health route is a GET, and
    // static servers reject anything they cannot serve as a file.
    return { state: 'no-backend', backend, detail: `the URL answered ${res.status} instead of the chat API` };
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    return {
      state: 'unreachable',
      backend,
      detail: timedOut ? 'the request timed out' : 'the request could not be made',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Turns a failed API call into something a person can act on.
 *
 * Returns the original message for ordinary failures (401 wrong password, 403
 * wrong send password, 400 bad input) and a diagnosis for the cases that are
 * really "there is no server here".
 */
export function explainApiError(err, probe = null) {
  const raw = err?.message || 'Something went wrong';
  if (!(err instanceof ApiError) && !err?.status) {
    return { kind: 'unknown', message: raw, hint: '' };
  }

  // Fetch itself failed: no server, no CORS, no route.
  if (err.status === 0) {
    return {
      kind: 'unreachable',
      message: 'Cannot reach the chat server.',
      hint: hintFor(probe, 'Make sure the Node server is running on this machine (npm start), then reload.'),
    };
  }

  const staticHost =
    err.status === 405 ||
    err.status === 404 ||
    err.status === 501 ||
    // 200 + no JSON: a static host served index.html for an API path.
    (err.status >= 200 && err.status < 300 && !err.payload) ||
    (!err.payload && /returned a page instead of data/i.test(raw));

  // A 200-with-HTML answer is proof on its own; 405/404 need the probe to
  // distinguish "static host" from "this route does not exist on our server".
  const selfEvident = err.status >= 200 && err.status < 300 && !err.payload;
  const noBackend = selfEvident || (probe && probe.state !== 'ok');

  if (staticHost && noBackend) {
    return {
      kind: 'no-backend',
      message: 'This page is being served by a static host, which has no chat API behind it.',
      hint:
        !probe || probe.state === 'unreachable'
          ? `The backend could not be reached${probe.backend ? ` at ${probe.backend}` : ''}. Start the Node server (npm start) — a static host alone cannot store messages or images.`
          : `Point the UI at your running Node server: append ?backend=http://<server-ip>:3000 to this URL, or run the app directly with npm start.`,
    };
  }

  if (err.status === 401 || err.status === 403) {
    return { kind: 'auth', message: raw, hint: '' };
  }

  return { kind: 'error', message: raw, hint: '' };
}

function hintFor(probe, fallback) {
  if (!probe) return fallback;
  if (probe.state === 'no-backend') {
    return `That address is a static host, not the chat server. Append ?backend=http://<server-ip>:3000 to this URL.`;
  }
  return probe.backend ? `${fallback} The configured backend is ${probe.backend}.` : fallback;
}

/** Absolute URL of the backend currently in use ('' when same-origin). */
export function backendLabel() {
  const origin = backendOrigin();
  if (origin) return origin;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export { absoluteUrl };
