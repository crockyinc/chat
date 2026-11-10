import { icon } from './icons.js';
import { avatarColor, initialsFor, shortSerial } from '../lib/device.js';

/**
 * Message rendering.
 *
 * Grouping follows Messenger: consecutive messages from the same device within
 * five minutes share one avatar/name header and stack their bubbles. The body is
 * already-sanitised HTML from the server, injected as-is so tables, formatting
 * and cell colours survive.
 */

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const escapeHtml = (value = '') =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function dayDivider(timestamp) {
  return `<div class="my-3 flex items-center justify-center">
    <span class="rounded-full border px-3 py-1 text-[11px] font-semibold muted" style="border-color:var(--border);background:var(--panel-bg)">${formatDay(
      timestamp,
    )}</span>
  </div>`;
}

function avatar(deviceId, displayName, size = 28) {
  return `<span class="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style="width:${size}px;height:${size}px;background:${avatarColor(deviceId)};font-size:${Math.round(size / 2.6)}px"
      title="${escapeHtml(displayName || deviceId)}">${escapeHtml(initialsFor(displayName, deviceId))}</span>`;
}

function authorLine(message) {
  return `<div class="msg-meta">
      <span class="msg-author">${escapeHtml(message.authorName || 'Unnamed device')}</span>
      <button type="button" class="serial-chip" data-copy-serial="${escapeHtml(message.authorId)}"
        title="Device serial no. ${escapeHtml(message.authorId)} — click to copy">
        #${escapeHtml(shortSerial(message.authorId))}
      </button>
      <time datetime="${new Date(message.createdAt).toISOString()}">${formatTime(message.createdAt)}</time>
    </div>`;
}

/** One image message (optionally several images in one bubble). */
function imageBubble(message, { mine }) {
  const attachments = message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : [];
  if (!attachments.length) return '';
  const images = attachments
    .map((att, index) => {
      const ratio = att.width && att.height ? att.width / att.height : null;
      const style = ratio ? `aspect-ratio:${ratio.toFixed(3)}` : '';
      return `<img class="msg-image ${mine ? 'outgoing' : ''}" src="${escapeHtml(att.url)}" alt="${escapeHtml(
        att.filename || 'Shared image',
      )}" loading="lazy" data-lightbox="${escapeHtml(att.url)}" data-filename="${escapeHtml(
        att.filename || 'image',
      )}" style="${style}" ${mine && index === attachments.length - 1 ? 'data-last="1"' : ''} />`;
    })
    .join('');
  return `<div class="flex flex-col gap-1">${images}</div>`;
}

/**
 * Renders a single message row.
 * @param {object} message
 * @param {object} ctx
 * @param {string} ctx.myId
 * @param {object|null} ctx.previous
 * @param {boolean} ctx.showDay
 */
export function renderMessage(message, { myId, previous = null, showDay = true } = {}) {
  const mine = message.authorId === myId;
  const grouped =
    previous &&
    previous.authorId === message.authorId &&
    message.createdAt - previous.createdAt < GROUP_WINDOW_MS &&
    message.kind !== 'system';
  const day = showDay ? dayDivider(message.createdAt) : '';
  const attachments = message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : [];

  if (message.kind === 'system') {
    return `${day}<div class="my-2 text-center text-[11.5px] muted"><span class="rounded-full bg-black/5 px-2.5 py-1 dark:bg-white/10">${escapeHtml(
      stripTags(message.body),
    )}</span></div>`;
  }

  const isImageOnly = message.kind === 'image' || (!stripTags(message.body).trim() && attachments.length);
  const bubbleClass = `bubble ${mine ? 'out' : 'in'}`;
  const bodyHtml = message.body ? `<div class="rich">${message.body}</div>` : '';

  const content = isImageOnly
    ? `<div class="msg-images relative" data-message-id="${message.id}">${imageBubble(message, { mine })}</div>`
    : `<div class="${bubbleClass}" data-message-id="${message.id}">${bodyHtml}</div>`;

  const avatarSlot = grouped ? '<span class="w-7 shrink-0"></span>' : avatar(message.authorId, message.authorName);

  const bubbleColumn = mine
    ? `<div class="flex min-w-0 max-w-[78%] flex-col items-end">
        ${grouped ? '' : authorLine(message)}
        ${content}
      </div>`
    : `<div class="flex min-w-0 max-w-[78%] flex-col items-start">
        ${grouped ? '' : authorLine(message)}
        ${content}
      </div>`;

  return `${day}<div class="msg-row group" data-id="${message.id}" data-author="${escapeHtml(message.authorId)}">
      ${mine ? '' : avatarSlot}
      ${bubbleColumn}
      ${mine ? avatarSlot : ''}
      <button type="button" class="btn-icon invisible shrink-0 opacity-0 transition group-hover:visible group-hover:opacity-100"
        data-menu-message="${message.id}" title="More" aria-label="Message options">${icon('chevronDown', { size: 14 })}</button>
    </div>`;
}

/** Renders a whole list, inserting day dividers and grouping metadata. */
export function renderMessageList(messages, { myId }) {
  let html = '';
  let previous = null;
  for (const message of messages) {
    const showDay = !previous || formatDay(previous.createdAt) !== formatDay(message.createdAt);
    html += renderMessage(message, { myId, previous, showDay });
    previous = message;
  }
  return html;
}

export function stripTags(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Small preview text used by the search results and notifications. */
export function previewText(message) {
  if (message.kind === 'image') return '📷 Photo';
  const text = stripTags(message.body);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}
