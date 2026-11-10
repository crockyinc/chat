/**
 * End-to-end test of the server: identification, uploads, socket broadcast,
 * sanitisation and deletion. Uses two simulated devices against a real server
 * on an ephemeral port, with an in-memory SQLite database.
 *
 *   node --test tests/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io as ioClient } from 'socket.io-client';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-test-'));
process.env.MAX_UPLOAD_MB = '2';

const { createApp } = await import('../server/index.js');
const { closeDatabase } = await import('../server/db.js');

let server;
let baseUrl;
const sockets = [];
let cookieA = '';
let cookieB = '';

before(async () => {
  const app = await createApp({ dbFile: ':memory:' });
  server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
});

async function identify(deviceId, displayName = '') {
  const response = await fetch(`${baseUrl}/api/auth/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, displayName }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { cookie, body: await response.json() };
}

function connect(cookie) {
  const socket = ioClient(baseUrl, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('hello', (payload) => resolve({ socket, hello: payload }));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 4000);
  });
}

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

test('device identity is persistent and stored with a display name', async () => {
  const a = await identify('11111111-aaaa-4bbb-8ccc-1234567890ab', 'First Laptop');
  cookieA = a.cookie;
  assert.equal(a.body.deviceId, '11111111-aaaa-4bbb-8ccc-1234567890ab');
  assert.equal(a.body.displayName, 'First Laptop');

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieA } });
  assert.equal(me.status, 200);
  const profile = await me.json();
  assert.equal(profile.displayName, 'First Laptop');

  const renamed = await fetch(`${baseUrl}/api/auth/me`, {
    method: 'PATCH',
    headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: "Ayesha's MacBook" }),
  });
  assert.equal((await renamed.json()).displayName, "Ayesha's MacBook");
});

test('anonymous devices cannot read messages', async () => {
  const response = await fetch(`${baseUrl}/api/messages`);
  assert.equal(response.status, 401);
});

test('rich text is sanitised but tables and cell styling survive', async () => {
  const { socket } = await connect(cookieA);
  const html =
    '<p onclick="steal()">Hello <strong>world</strong></p>' +
    '<table><tbody><tr><td style="background-color:#fff3c4;text-align:center;font-weight:700" data-cell-style=\'{"bold":true}\'>A1</td></tr></tbody></table>' +
    '<script>alert(1)</script><img src="javascript:alert(1)">';
  const ack = await emitAck(socket, 'message:send', { body: html, attachmentIds: [] });
  assert.equal(ack.ok, true);
  const body = ack.messages[0].body;
  assert.ok(body.includes('<table>'), 'table kept');
  assert.ok(body.includes('background-color:#fff3c4'), 'cell background kept');
  assert.ok(body.includes('data-cell-style'), 'cell style json kept');
  assert.ok(!/onclick|script|javascript:/i.test(body), 'unsafe markup removed');
});

test('a message reaches every connected device instantly', async () => {
  const b = await identify('22222222-bbbb-4ccc-8ddd-1234567890ab', 'Second Phone');
  cookieB = b.cookie;
  const a = await connect(cookieA);
  const second = await connect(cookieB);

  const received = new Promise((resolve) => second.socket.once('message:new', resolve));
  const ack = await emitAck(a.socket, 'message:send', { body: '<p>broadcast me</p>' });
  assert.equal(ack.ok, true);
  const message = await received;
  assert.equal(message.authorId, '11111111-aaaa-4bbb-8ccc-1234567890ab');
  assert.equal(message.authorName, "Ayesha's MacBook");
  assert.ok(message.body.includes('broadcast me'));
});

test('images upload locally, are signed, and arrive as their own messages', async () => {
  const { socket } = await connect(cookieA);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('images', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const upload = await fetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    headers: { Cookie: cookieA },
    body: form,
  });
  assert.equal(upload.status, 201);
  const { attachments } = await upload.json();
  assert.equal(attachments.length, 1);
  assert.match(attachments[0].id, /^[0-9a-f-]{36}$/);

  const ack = await emitAck(socket, 'message:send', {
    body: '<p>look at this</p>',
    attachmentIds: [attachments[0].id],
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.messages.length, 2, 'text + one image message');
  const imageMessage = ack.messages.find((m) => m.kind === 'image');
  assert.ok(imageMessage.attachment.url.includes('sig='), 'attachment url is signed');

  // The signed URL works, an unsigned one does not.
  const signed = await fetch(`${baseUrl}${imageMessage.attachment.url}`);
  assert.equal(signed.status, 200);
  assert.equal(signed.headers.get('content-type'), 'image/png');
  const unsigned = await fetch(`${baseUrl}/uploads/attachments/${attachments[0].id}`);
  assert.equal(unsigned.status, 403);
});

test('non-image uploads are rejected', async () => {
  const form = new FormData();
  form.append('images', new Blob(['#!/bin/sh'], { type: 'text/x-sh' }), 'evil.sh');
  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    headers: { Cookie: cookieA },
    body: form,
  });
  assert.equal(response.status, 415);
});

test('only the author can delete a message; deletion broadcasts to everyone', async () => {
  const a = await connect(cookieA);
  const b = await connect(cookieB);
  const ack = await emitAck(a.socket, 'message:send', { body: '<p>delete me</p>', attachmentIds: [] });
  const id = ack.messages[0].id;

  const forbidden = await emitAck(b.socket, 'message:delete', { id });
  assert.equal(forbidden.ok, false);

  const deleted = new Promise((resolve) => b.socket.once('message:deleted', resolve));
  const ok = await emitAck(a.socket, 'message:delete', { id });
  assert.equal(ok.ok, true);
  const payload = await deleted;
  assert.equal(payload.id, id);
});

test('presence lists every connected device by name', async () => {
  const a = await connect(cookieA);
  const b = await connect(cookieB);
  const seen = new Promise((resolve) => {
    b.socket.on('presence:update', (payload) => {
      if (payload.users.length >= 2) resolve(payload);
    });
    setTimeout(() => resolve({ users: [] }), 3000);
  });
  // Any profile update re-broadcasts the roster (connection events may have
  // fired before the listener above was attached).
  const ack = await emitAck(a.socket, 'profile:update', { displayName: "Ayesha's MacBook" });
  assert.equal(ack.ok, true);
  const roster = await seen;
  const names = roster.users.map((u) => u.displayName).sort();
  assert.deepEqual(names, ["Ayesha's MacBook", 'Second Phone']);
});

test('history is paginated and ordered', async () => {
  const response = await fetch(`${baseUrl}/api/messages?limit=2`, { headers: { Cookie: cookieA } });
  const { messages } = await response.json();
  assert.ok(messages.length <= 2);
  if (messages.length === 2) assert.ok(messages[0].id < messages[1].id);
});

test('empty messages are refused', async () => {
  const a = await connect(cookieA);
  const ack = await emitAck(a.socket, 'message:send', { body: '<p>   </p>', attachmentIds: [] });
  assert.equal(ack.ok, false);
});

test('export produces a self-contained HTML file', async () => {
  const response = await fetch(`${baseUrl}/api/export`, { headers: { Cookie: cookieA } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="lan-chat-/);
  const html = await response.text();
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('Ayesha'));
});

test('sockets without a valid session are refused', async () => {
  const forged = ioClient(baseUrl, {
    transports: ['websocket'],
    extraHeaders: { Cookie: 'lm_session=99999999-dead-4bee-8fff-000000000000.9999999999.forged' },
    reconnection: false,
  });
  sockets.push(forged);
  const failed = await new Promise((resolve) => {
    forged.on('connect_error', (err) => resolve(err.message));
    forged.on('hello', () => resolve('connected'));
    setTimeout(() => resolve('timeout'), 3000);
  });
  assert.equal(failed, 'unauthorized');
});

test('a signed-out session cannot fetch history', async () => {
  const response = await fetch(`${baseUrl}/api/messages`, {
    headers: { Cookie: 'lm_session=garbage' },
  });
  assert.equal(response.status, 401);
});
