/**
 * Seeds the local database with a few example messages, useful for a quick
 * look at formatting, tables and images without a second device.
 *
 *   npm run seed            # only runs when the database is empty
 *   npm run seed -- --force # adds the examples again
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDirs } from '../server/config.js';
import { openDatabase, listMessages, upsertUser, insertMessage, getDb, closeDatabase } from '../server/db.js';
import crypto from 'node:crypto';
import { sanitizeRichText } from '../server/security.js';

const force = process.argv.includes('--force');

const DEVICES = [
  { id: '11111111-1111-4111-8111-111111111111', name: "Ayesha's MacBook" },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Studio PC' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Pixel 8' },
];

const EXCEL_TABLE = `<table>
  <tbody>
    <tr>
      <th data-cell-style='{"bold":true,"background":"#0a84ff","color":"#ffffff","align":"center"}'>Region</th>
      <th data-cell-style='{"bold":true,"background":"#0a84ff","color":"#ffffff","align":"center"}'>Q1</th>
      <th data-cell-style='{"bold":true,"background":"#0a84ff","color":"#ffffff","align":"center"}'>Q2</th>
      <th data-cell-style='{"bold":true,"background":"#0a84ff","color":"#ffffff","align":"center"}'>Growth</th>
    </tr>
    <tr>
      <td data-cell-style='{"bold":true}'>North</td>
      <td data-cell-style='{"align":"right"}'>12,400</td>
      <td data-cell-style='{"align":"right"}'>15,900</td>
      <td data-cell-style='{"align":"right","color":"#1f7a1f","background":"#d7f5dd"}'>+28%</td>
    </tr>
    <tr>
      <td data-cell-style='{"bold":true}'>South</td>
      <td data-cell-style='{"align":"right"}'>9,100</td>
      <td data-cell-style='{"align":"right"}'>8,450</td>
      <td data-cell-style='{"align":"right","color":"#b00020","background":"#ffd0d0"}'>-7%</td>
    </tr>
    <tr>
      <td data-cell-style='{"bold":true}'>Total</td>
      <td data-cell-style='{"align":"right","bold":true,"background":"#fff3c4"}'>21,500</td>
      <td data-cell-style='{"align":"right","bold":true,"background":"#fff3c4"}'>24,350</td>
      <td data-cell-style='{"align":"right","bold":true,"background":"#fff3c4"}'>+13%</td>
    </tr>
  </tbody>
</table>`;

const MESSAGES = [
  {
    device: 0,
    body: `<p>Welcome to the <strong>LAN messenger</strong> 👋 Everything you see here lives on this computer — no cloud, no account.</p>`,
  },
  {
    device: 1,
    body: `<h2>What you can do</h2>
      <ul>
        <li><strong>Rich text</strong> — headings, colours, highlights, quotes, links</li>
        <li><em>Spreadsheets</em> — paste straight from Excel or Google Sheets</li>
        <li><span style="background-color:#fff3c4">Images</span> — drag, drop or Ctrl+V</li>
      </ul>`,
  },
  {
    device: 0,
    body: `<p>Here's a table pasted from Excel, cell colours and all:</p>${EXCEL_TABLE}`,
  },
  {
    device: 2,
    body: `<blockquote>Open this page on your phone using the same Wi-Fi and the message appears instantly.</blockquote>
      <p>Device serials are generated in the browser with <code>crypto.randomUUID()</code> and stored locally.</p>`,
  },
];

/** A tiny valid PNG so the seeded message has a real attachment to show. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAJUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAHwbWmAAAcCzRHEAAAAASUVORK5CYII=',
  'base64',
);

ensureDirs();
openDatabase(paths.dbFile);

if (!force && listMessages({ limit: 1 }).length) {
  console.log('Database already has messages — use `npm run seed -- --force` to add examples anyway.');
  closeDatabase();
  process.exit(0);
}

for (const device of DEVICES) upsertUser({ deviceId: device.id, displayName: device.name });

const base = Date.now() - 1000 * 60 * 42;
MESSAGES.forEach((message, index) => {
  const device = DEVICES[message.device];
  insertMessage({
    authorId: device.id,
    authorName: device.name,
    kind: 'text',
    body: sanitizeRichText(message.body),
    createdAt: base + index * 1000 * 90,
  });
});

// One image message, stored exactly like an uploaded file.
const attachmentId = crypto.randomUUID();
const imageFile = path.join(paths.attachmentsDir, `${attachmentId}.png`);
fs.writeFileSync(imageFile, PIXEL_PNG);
fs.writeFileSync(
  path.join(paths.attachmentsDir, `${attachmentId}.json`),
  JSON.stringify({ filename: 'sample-image.png', uploadedBy: DEVICES[2].id, uploadedAt: Date.now() }),
);
insertMessage({
  authorId: DEVICES[2].id,
  authorName: DEVICES[2].name,
  kind: 'image',
  body: '',
  attachment: { id: attachmentId, filename: 'sample-image.png', mime: 'image/png', size: PIXEL_PNG.length },
  createdAt: base + MESSAGES.length * 1000 * 90,
});

const total = getDb().prepare('SELECT COUNT(*) AS n FROM messages').get().n;
console.log(`Seeded ${total} example messages into ${paths.dbFile}`);
closeDatabase();
