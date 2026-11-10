import express from 'express';
import { config } from '../config.js';
import { signAttachmentUrl } from '../security.js';
import { stripHtml } from '../messages-service.js';

/**
 * One-click export of the whole room as a single, self-contained HTML file
 * (images stay in /uploads and are referenced by signed URL). No cloud, no zip
 * library needed.
 */
export function exportRouter({ db }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const messages = db.listMessages({ limit: 5000 });
    const rows = messages
      .map((message) => {
        const name = message.authorName || message.authorId.slice(0, 8);
        const when = new Date(message.createdAt).toLocaleString();
        const image = message.attachment
          ? `<div><img src="${signAttachmentUrl(message.attachment.id, 60 * 60 * 24 * 30)}" alt="attachment" style="max-width:420px;border-radius:10px"/></div>`
          : '';
        return `<article class="msg">
          <header><strong>${escape(name)}</strong>
            <code>#${escape(message.authorId.slice(0, 8))}</code>
            <time>${escape(when)}</time>
          </header>
          <div class="body">${message.body || ''}${image}</div>
        </article>`;
      })
      .join('\n');

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${escape(config.roomName)} — export</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 "Segoe UI", system-ui, sans-serif; max-width: 900px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 20px; }
  .meta { color: #65676b; font-size: 12px; margin-bottom: 24px; }
  .msg { border-top: 1px solid #e4e6eb; padding: 12px 0; }
  .msg header { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: #65676b; }
  .msg header strong { color: inherit; font-size: 13px; }
  .msg code { font-size: 11px; background: #f0f2f5; padding: 1px 6px; border-radius: 999px; }
  .body { margin-top: 4px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #d0d7de; padding: 4px 8px; vertical-align: top; }
  th { background: #f7f8fa; }
  img { max-width: 100%; }
  blockquote { border-left: 3px solid #0a84ff; margin: 8px 0; padding-left: 10px; color: #65676b; }
</style></head>
<body>
  <h1>${escape(config.roomName)}</h1>
  <p class="meta">${messages.length} messages · exported ${escape(new Date().toLocaleString())} · stored locally, never in the cloud</p>
  ${rows}
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lan-chat-${new Date().toISOString().slice(0, 10)}.html"`,
    );
    res.send(html);
  });

  return router;
}

function escape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { stripHtml };
