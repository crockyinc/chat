/**
 * Where does the chat backend live?
 *
 * - Normal LAN / self-hosted use: same origin, so this resolves to '' and every
 *   request stays relative (`/api/...`, `/socket.io`).
 * - Static-host deployment (Cloudflare Pages, GitHub Pages…): point the UI at a
 *   Node server running somewhere else. Configure it with, in order of priority:
 *
 *     1. `?backend=https://chat.example.com` in the URL (remembered after that)
 *     2. `window.LAN_CHAT_BACKEND` — set it from a small `config.js` you add to
 *        the static build, e.g. `window.LAN_CHAT_BACKEND = 'https://chat.example.com'`
 *     3. whatever was previously saved in localStorage
 *
 * Anything that is not an absolute http(s) URL is ignored, so a bad query
 * parameter can never break the app.
 */
const STORAGE_KEY = 'lm.backend';

let cached;

export function backendOrigin() {
  if (cached !== undefined) return cached;

  const fromQuery =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('backend') : null;
  if (fromQuery) {
    const cleaned = normalize(fromQuery);
    if (cleaned) {
      try {
        localStorage.setItem(STORAGE_KEY, cleaned);
      } catch {
        /* private mode — the query parameter still works for this visit */
      }
      // Keep the URL tidy once the choice is stored.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('backend');
        window.history.replaceState({}, '', url);
      } catch {
        /* ignore */
      }
      cached = cleaned;
      return cached;
    }
  }

  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }

  const fromGlobal = typeof window !== 'undefined' ? window.LAN_CHAT_BACKEND : null;
  cached = normalize(stored) || normalize(fromGlobal) || '';
  return cached;
}

function normalize(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return '';
  return trimmed;
}

/** Absolute URL for an API path, honouring the configured backend. */
export function apiUrl(path) {
  const base = backendOrigin();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Makes a server-relative URL (/uploads/…) absolute when a backend is configured. */
export function absoluteUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const base = backendOrigin();
  if (!base || !url.startsWith('/')) return url;
  return `${base}${url}`;
}

/** Rewrites root-relative asset URLs inside rich-text HTML. */
export function absoluteHtmlUrls(html) {
  if (!html) return html;
  const base = backendOrigin();
  if (!base) return html;
  return String(html).replace(/(\ssrc=")\/(uploads\/)/g, `$1${base}/$2`);
}

/** True when this deployment is a static shell talking to a remote backend. */
export function isRemoteBackend() {
  return Boolean(backendOrigin());
}
