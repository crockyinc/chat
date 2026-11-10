import crypto from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { installSecret, config } from './config.js';

const SECRET = installSecret();

/* ------------------------------------------------------------- signatures */

function hmac(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

export function timingSafeEqual(a = '', b = '') {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Signed, expiring URL for an attachment (images are served only with a valid signature). */
export function signAttachmentUrl(attachmentId, ttlSeconds = 60 * 60 * 24 * 7) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/uploads/attachments/${attachmentId}?exp=${exp}&sig=${hmac(`${attachmentId}:${exp}`)}`;
}

export function verifyAttachmentSignature(id, exp, sig) {
  if (!id || !exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  return timingSafeEqual(hmac(`${id}:${exp}`), sig);
}

/* ---------------------------------------------------------------- session */

/** Cookie attributes for the session token (SameSite=None for cross-site setups). */
export function sessionCookie(deviceId, maxAgeSeconds = 90 * 24 * 60 * 60) {
  const token = createSessionToken(deviceId, maxAgeSeconds);
  const parts = [
    `lm_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${config.cookieSameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.cookieSameSite === 'None') parts.push('Secure');
  return { token, header: parts.join('; ') };
}

export function createSessionToken(deviceId, ttlSeconds = 60 * 60 * 24 * 90) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${deviceId}.${exp}.${hmac(`session:${deviceId}:${exp}`)}`;
}

export function readSessionToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [deviceId, exp, sig] = parts;
  if (!deviceId || !exp) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  if (!timingSafeEqual(hmac(`session:${deviceId}:${exp}`), sig)) return null;
  return { deviceId };
}

export function parseCookies(header = '') {
  const out = {};
  for (const chunk of String(header).split(';')) {
    const idx = chunk.indexOf('=');
    if (idx === -1) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** Resolves { deviceId } from the session cookie (or a bearer token for curl/tests). */
export function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const fromCookie = readSessionToken(cookies.lm_session);
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const deviceId = token.split('.')[0];
    const session = readSessionToken(token);
    if (session) return session;
    if (config.roomPassword && timingSafeEqual(config.roomPassword, token)) {
      return { deviceId, viaPassword: true };
    }
  }
  return null;
}

/* ----------------------------------------------------------- sanitisation */

const ALIGN = ['left', 'center', 'right', 'justify'];

const STYLE_PROPS = [
  'text-align',
  'background-color',
  'color',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-decoration-line',
  'vertical-align',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'width',
  'min-width',
  'height',
];

const SAFE_STYLE = /^[a-zA-Z0-9#%.,()\s\-/'"!+*]+$/;

/**
 * Whitelist sanitiser for everything a client sends in `body`.
 * Tables keep alignment/background/border styles so Excel pastes survive.
 */
export function sanitizeRichText(html) {
  if (!html) return '';
  return sanitizeHtml(String(html).slice(0, 400_000), {
    allowedTags: [
      'p', 'br', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr',
      'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption',
    ],
    allowedAttributes: {
      '*': ['style', 'class', 'data-cell-style', 'dir', 'align'],
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      ol: ['start', 'type'],
      table: ['border', 'cellpadding', 'cellspacing', 'data-table-style'],
      col: ['span', 'width'],
      th: ['colspan', 'rowspan', 'width', 'scope'],
      td: ['colspan', 'rowspan', 'width'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: {
      // Force external links to open in a new tab, safely.
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
    },
    allowedStyles: Object.fromEntries(
      ['*', 'td', 'th', 'table', 'col', 'span', 'p'].map((tag) => [
        tag,
        Object.fromEntries(
          STYLE_PROPS.map((prop) => [
            prop,
            [
              new RegExp(`^(${ALIGN.join('|')})$`),
              SAFE_STYLE,
            ],
          ]),
        ),
      ]),
    ),
    // Drop empty tables that some browsers emit when copying from Excel.
    exclusiveFilter: (frame) =>
      frame.tag === 'img'
        ? !/^https?:\/\/|^\/uploads\//.test(frame.attribs.src || '')
        : false,
  });
}

export function sanitizePlainText(text) {
  return String(text || '').replace(/\u0000/g, '').slice(0, 20_000);
}

/* ------------------------------------------------------------ rate limits */

export function createRateLimiter({ points = 30, windowMs = 10_000 } = {}) {
  const hits = new Map();
  return function allow(key) {
    const now = Date.now();
    const bucket = hits.get(key);
    if (!bucket || bucket.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > points) return false;
    return true;
  };
}
