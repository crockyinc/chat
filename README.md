# LAN Messenger — zero-cloud rich chat for your local network

A tiny self-hosted messenger with a **Messenger-style UI** that does rich text, **Excel-style
spreadsheets** and **images**, synced in real time between every device on the same Wi-Fi or LAN.

Everything runs on **one Node process**: the web app, the WebSocket server, the SQLite database and
the uploaded images. No accounts, no cloud storage, no third-party APIs, no CDN — open the page on
your phone and your laptop and type.

```
┌──────────┐   Wi-Fi / LAN   ┌───────────────────────────────┐
│  phone   │◄───────────────►│  node server/index.js         │
└──────────┘   Socket.io     │  ├─ Express  (app + API)      │
┌──────────┐                 │  ├─ Socket.io (real-time)     │
│  laptop  │◄───────────────►│  ├─ SQLite   (data/*.db)      │
└──────────┘                 │  └─ /uploads (local images)   │
                             └───────────────────────────────┘
```

---

## 1. Quick start

Requirements: **Node.js 22.5+** (for the built-in `node:sqlite` module) and npm.

```bash
git clone <this-repo> && cd chat
npm install
npm start           # builds the client, then serves on http://localhost:3000
```

Startup prints every address you can open from other devices:

```
  Local LAN Chat is running — zero cloud, everything stays on this machine.
   →  http://localhost:3000
   →  http://192.168.1.24:3000

  Database: /…/data/lan-messenger.db
  Uploads:  /…/uploads/attachments
```

Open the second URL on your phone (same Wi-Fi), set a display name, and start chatting.
On first visit the app generates a **device serial number** with `crypto.randomUUID()` and keeps it
in `localStorage`; you can optionally set a display name such as `Ayesha's MacBook`.

Want some sample content to look at? `npm run seed` inserts a few messages, including an
Excel-styled table and an image.

> **Try it in 30 seconds:** the app is already running in this session's preview. Open it, type a
> name, and paste a spreadsheet from Excel into the composer. To see the real-time sync, open the
> same preview URL on a second tab (or your phone on the same Wi-Fi) — messages appear in both
> instantly, with each device's own serial number.

### Development

```bash
npm run dev      # esbuild + Tailwind watch mode, server restarts on change
npm test         # server integration tests (16)
npm run test:ui  # browser-level tests with jsdom (13)
npm run verify   # both suites
npm run build    # production bundle
```

### Deploying the UI to Cloudflare

`npm run build:pages` writes a self-contained static bundle to `dist/` (UI shell only — the realtime
backend always stays on Node). `wrangler.toml` is committed with `[build]` + `[assets]`, which both
`wrangler deploy` (Workers static assets) and `wrangler pages deploy dist` accept. Full instructions,
including the two different build errors and how to point the shell at your backend, are in
[`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md).

### Configuration (all optional, via environment variables)

| Variable            | Default              | Meaning                                              |
| ------------------- | -------------------- | ---------------------------------------------------- |
| `PORT`              | `3000`               | HTTP port                                            |
| `HOST`              | `0.0.0.0`            | Bind address (all interfaces, so the LAN can reach it) |
| `ROOM_NAME`         | `Local LAN Chat`     | Title shown in the sidebar                           |
| `ROOM_PASSWORD`     | *(empty)*            | Require a shared password before joining             |
| `SEND_PASSWORD`     | `QW4hd`              | Password required for every message (empty = off)    |
| `DATA_DIR`          | `./data`             | Where the SQLite database and install secret live    |
| `UPLOADS_DIR`       | `./uploads`          | Where images are stored                              |
| `DB_FILE`           | `$DATA_DIR/lan-messenger.db` | Database path                                 |
| `MAX_UPLOAD_MB`     | `12`                 | Max size of one image                                |
| `HISTORY_LIMIT`     | `200`                | Messages loaded per page                             |
| `RETENTION_DAYS`    | `0` (keep forever)   | Prune messages older than N days on startup          |
| `TRUST_PROXY`       | `0`                  | Set to `1` when running behind a reverse proxy       |

```bash
ROOM_PASSWORD=coffee PORT=8080 npm start
```

---

## 2. Feature tour

### Chat
* Messenger-style bubbles, grouped by device, avatar per device, day dividers, timestamps.
* Every bubble shows the author's **display name** plus their **device serial** (`#a1b2c3d4`);
  click the serial to copy the full UUID.
* Live presence ("2 devices online"), typing indicators, unread-while-hidden desktop notifications.
* Click a device in the sidebar to filter the timeline to that device; search filters messages.
* Hover a message → copy as text / copy as formatted content / delete (own messages only).
* Lightbox for images, one-click **export of the whole chat to a single HTML file**.
* Invite dialog with the LAN URLs and a **QR code generated server-side** (no third-party QR API).
* Dark mode (follows the OS on first run, remembered after that).

### Rich text editor (Tiptap)
Bold, italic, underline, strikethrough, **font size**, **font colour**, **highlight**, H1/H2/H3,
paragraph styles, left/center/right/justify, bulleted and numbered lists, links (Ctrl+K),
blockquotes, code blocks, horizontal rules, undo/redo, clear formatting, and a **format painter**
(copy formatting, then click a target).

### Spreadsheet editor (the important part)
Insert a table with any number of rows/columns, then:
* **Column letters (A, B, C…) stay sticky** above the grid — click one to select the whole column,
  click the corner to select the table. The header row of letters tracks column resizing.
* Edit cells in place; **Tab/Shift+Tab** move between cells, arrow keys navigate.
* **Add/remove rows and columns** (above, below, left, right) from the contextual table toolbar.
* **Resize columns** by dragging the right edge of a cell.
* Per-cell **bold, italic, underline, text colour, background fill, borders, alignment** — via the
  cell toolbar that appears whenever the cursor is inside a table, or the table's formatting group.
* Several tables per document, each independently editable.
* Wide tables scroll **horizontally** inside a rounded wrapper, without breaking the bubble layout.

**Excel / Google Sheets interop**
* Copy cells in Excel and paste into the editor: tab characters inside `<td>` elements are repaired
  into real cells, and per-cell **fills, text colours, bold and alignment** are preserved.
* Copy plain tab-separated text: it becomes a real table automatically.
* Paste into an existing table with a **cell range selected** → values fill the range (Excel
  behaviour), and the table **grows automatically** when the clipboard is bigger.
* Paste with the caret in a cell → values flow right/down from that cell, growing as needed.
* Copy a cell range out of the app → the clipboard gets TSV *and* HTML, so it pastes back into Excel.
* `Ctrl/Cmd+Shift+V` pastes as plain text when you do *not* want a table.
* Formatting can be round-tripped through the server: cell styles are stored both as inline CSS and
  as `data-cell-style` JSON, which is on the sanitiser whitelist.

### Send password

Every send is password protected. Clicking **Send** (or pressing Enter) opens a password prompt;
the message is only stored if the password is correct, and a wrong password keeps your draft so you
can retry.

* Default password: **`QW4hd`** — change it with `SEND_PASSWORD`
* Enforced **server-side**: the password travels with the message and is verified before anything is
  written, so a modified client or a direct socket/API call cannot bypass it
* Cancel sends nothing; images are uploaded once and reused across retries
* Wrong attempts reset on success; `SEND_PASSWORD_MAX_ATTEMPTS` exists as a hook for stricter
  policies, and per-socket rate limiting (20 msgs / 10 s) still applies
* Disable the prompt entirely with `SEND_PASSWORD=` (empty)

```bash
SEND_PASSWORD='my-team-secret' npm start
```

### Images
* Drag & drop onto the composer, `Ctrl+V` a screenshot, or use the attach button (up to 6 at once).
* Stored on disk under `uploads/attachments/` with a random UUID filename plus a small `.json`
  sidecar holding the original name. Served through **HMAC-signed, expiring URLs**.
* Images pasted *inside* rich text (full editor) are signed at render time too.

---

## 3. How it is built

```
server/
  index.js            app wiring: express, socket.io, static files, startup banner
  config.js           env-driven configuration + LAN address discovery
  db.js               SQLite schema/queries (node:sqlite)
  messages-service.js validation, attachment/one-message-per-image splitting, broadcast
  realtime.js         Socket.io auth, events, presence, typing, rate limiting
  security.js         sanitisation, HMAC signing, sessions, rate limiter
  uploads.js          multer storage, type/size limits, signed serving, sidecar metadata
  presence.js         in-memory online roster
  routes/auth.js      /api/auth/*   identity, room metadata, renames
  routes/messages.js  /api/messages history + REST fallback, inline-image signing
  routes/export.js    /api/export   whole room as one HTML file
  routes/qr.js        /api/qr       server-rendered QR code
client/
  main.js             boot, sockets, presence, modals, wiring
  lib/                device identity, API, socket wrapper, tiny store
  ui/                 chat view, composer, full editor, message rendering, icons
  editor/             Tiptap setup, toolbars, clipboard/Excel logic
    extensions/       spreadsheet cell styles, sticky sheet header, Excel paste
tests/                server integration tests + jsdom browser tests
public/               index.html shell, built CSS/JS
```

### Request / data flow
1. The browser creates (or reuses) its `crypto.randomUUID()` device id in `localStorage`.
2. `POST /api/auth/identify` stores the id + display name and sets an HTTP-only, HMAC-signed
   session cookie (90 days).
3. Socket.io authenticates from that cookie; the client joins the single room.
4. Sending: HTML body is sanitised server-side, images must reference files that were already
   uploaded (the server looks them up by id — clients cannot point at arbitrary paths), then rows
   are written and broadcast to everyone with signed attachment URLs.
5. History is paginated by message id, so reconnects can backfill without duplicates.

### Storage
```sql
users       (device_id PK, display_name, created_at, last_seen)
messages    (id PK, author_id, author_name, kind, body, attachment, created_at)
attachments (id PK, message_id, filename, mime, size, width, height, created_at)
```
Images live on the filesystem; everything else is in `data/lan-messenger.db` (WAL mode).
Delete the database and the uploads folder to start from scratch.

### Security notes (LAN-appropriate, not internet-grade)
* All HTML is run through a server-side whitelist sanitiser; `<script>`, event handlers and
  `javascript:` URLs are stripped, styles are limited to a property/value whitelist, and tables keep
  only formatting-related attributes.
* Images: MIME whitelist (PNG/JPEG/WebP/GIF/AVIF), 12 MB cap, random UUID filenames, `nosniff`.
* Attachment URLs are HMAC-signed and expire; the signing secret is generated once per install.
* Sessions, rate limits (20 messages / 10 s per socket) and per-message author checks for deletes.
* Optional `ROOM_PASSWORD` gate for the whole room.

> This app is designed for a trusted LAN. If you expose it to the internet, put it behind HTTPS
> (reverse proxy) and set `ROOM_PASSWORD`.

---

## 4. Tests

```
npm test        # 16 server tests: identity, sanitisation, broadcast, uploads/signing,
                # upload rejection, delete permissions, presence, pagination, export, auth,
                # and the send-password gate (missing / wrong / correct, REST + socket)
npm run test:ui # 13 browser tests (jsdom): boots the real bundle against a real server,
                # joins, receives live messages, renders Excel tables, formats,
                # spreadsheet header selection + cell styling + real Excel paste, and the
                # password prompt (opens on Send, wrong password rejected, cancel keeps the
                # draft, correct password sends)
```

---

## 5. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Other devices can't connect | Make sure they are on the same network and your OS firewall allows the port. Use the LAN URL printed at startup (not `localhost`). |
| `node:sqlite` not found | Use Node 22.5+ (`node -v`). Node 24+ has it stable. |
| "Link expired — reload the chat" on an image | Signed URLs are time limited; a reload re-signs the current messages. |
| Tables look cramped on a phone | Rotate to landscape or use the full-screen editor (expand icon) — wide tables scroll horizontally. |
| Port already in use | `PORT=3001 npm start`. |
| Cloudflare build fails with `Could not detect a directory containing static files` | That is a **Pages** build with no build command. Set build command `npm run build:pages` and output directory `dist`. |
| Cloudflare build fails with `Missing entry-point to Worker script or to assets directory` | That is a **Worker** build reading a config without `[assets]`. The committed `wrangler.toml` has `[build]` + `[assets]`; see `docs/DEPLOY-CLOUDFLARE.md` §1a. Note the static shell only — the realtime backend still needs Node. |
