# Deploying on Cloudflare

> **Which target are you on?** Two different Cloudflare products can build this repo, and they read
> `wrangler.toml` differently:
>
> | Your Cloudflare project | How it builds | Config lives in |
> | --- | --- | --- |
> | **Worker** (Workers Builds / `wrangler deploy`) | Git integration runs one `wrangler deploy`; a `[build]` command runs first | `wrangler.toml` → `[build]` + `[assets]` |
> | **Pages** (`wrangler pages deploy`, or a Pages project from Git) | Dashboard build command, or `npm run pages:deploy` locally | Dashboard settings (§3) — `pages_build_output_dir` must **not** be in `wrangler.toml` |

## 0. Read the error string — it names the target

Each failure mode maps to exactly one target and one fix. Match your log line here before changing
anything:

| Log line | Target | Cause | Fix |
| --- | --- | --- | --- |
| `Could not detect a directory containing static files (e.g. html, css and js) for the project` | **Workers** (Git-integrated build, autoconfig) | The commit being built has **no Wrangler config and no `index.html`** — autoconfig scans the repo, finds neither, and gives up | Make sure the deploy branch actually contains the app: `[build]` + `[assets]` in `wrangler.toml`, or an `index.html` in the repo. See §0a. |
| `Missing entry-point to Worker script or to assets directory` | **Workers** | A `wrangler.toml` exists but has no `[assets]` and no `main` (for example it only has `pages_build_output_dir`, which `wrangler deploy` ignores) | §1a |
| `Must specify a directory of assets to deploy` | **Pages** (`wrangler pages deploy`) | No `<directory>` argument and no `pages_build_output_dir` | §2 — pass `dist`, or set it in the dashboard |

> Note the first two say *Worker*, not Pages, even though the words "static files" sound like Pages.
> Never file the first error under the Pages instructions: Pages would have said
> `Must specify a directory of assets to deploy` instead.

### 0a. "Could not detect a directory…" on the deploy branch

This one is almost always a **wrong-branch or empty-branch deploy**, not a build-setting problem.
Wrangler's autoconfig runs `findAssetsDir()`: it looks for `index.html` in the project root, then one
level down, and it only considers `wrangler.json` / `wrangler.jsonc` / `wrangler.toml` at that same
root. Nothing found → that error, before any of your Cloudflare settings are even consulted.

So confirm what the deployed commit actually contains:

```bash
git ls-tree -r --name-only origin/main      # the branch the project builds
```

A healthy result lists the app (`package.json`, `public/index.html`, `wrangler.toml`, `server/`…).
If it prints only `README.md`, the Cloudflare project is building a branch that does not have the
code yet, and no Cloudflare setting can fix it — the commits have to reach that branch first.

Private repository? Cloudflare needs GitHub App access to it (Workers &amp; Pages → your project →
**Settings → Build → Git repository**); without access it builds whatever it can see, or reruns an old
commit. Public repository: just confirm the branch name matches.

Reproduce the failure locally without Cloudflare, on any branch:

```bash
git clone --branch main <repo> /tmp/probe && cd /tmp/probe
wrangler deploy --dry-run     # prints the same error if the branch has no app
```

## Read this first: what Pages can and cannot run

Cloudflare Pages is a **static asset host** (optionally with Workers functions). This app is a
Node.js server: Express routes, Socket.io, `node:sqlite` and images written to disk. None of that
executes on Pages.

| Piece | Self-hosted Node (`npm start`) | Cloudflare Pages (static) |
| --- | --- | --- |
| UI, editor, spreadsheet | ✅ | ✅ |
| Real-time sync (Socket.io) | ✅ | ❌ needs a separate backend |
| SQLite storage | ✅ | ❌ |
| Image uploads to `uploads/` | ✅ | ❌ |
| Sessions / signed image URLs | ✅ | ❌ |

So there are three honest options, in order of usefulness:

1. **Hybrid (recommended):** UI on Pages, backend on any Node host (see §4).
2. **Pages only:** deploy the static shell — it boots and renders, but every API call fails, so the
   join screen cannot complete. Good only for previewing the design.
3. **Not Pages:** run the whole app on a Node-capable host (Fly.io, Railway, Render, a VPS, a
   Raspberry Pi, or Docker on your LAN). One command, zero config — see §5.

---

## 1. Why your build failed

```
✘ [ERROR] Could not detect a directory containing static files (e.g. html, css and js) for the project
```

`wrangler pages deploy` needs a directory with a real static site. In this repo:

* `public/index.html` **is** committed, but
* `public/css/app.css` and `public/js/app.js` are **gitignored build artifacts**, and
* nothing told Pages to run a build or where the output lives.

So the upload found an HTML shell with no CSS/JS, and Wrangler refused it.

There is a second, subtler problem: `public/index.html` references `/css/app.css` and `/js/app.js`
with **root-absolute** paths. Those break if the site is ever served from a sub-path, and they are
one more reason to ship a dedicated, relocatable bundle.

## 1a. Why a *Workers* build fails (check name: "Workers Builds: ...")

```
✘ [ERROR] Missing entry-point to Worker script or to assets directory
```

A Worker build runs `wrangler deploy`, which needs a `main` script or an `[assets]` directory. The
repository used to only carry `pages_build_output_dir`, a key that `wrangler deploy` ignores — and
`main` + `pages_build_output_dir` cannot coexist in one file (Wrangler rejects that combination
outright). The committed configuration now targets the Worker form, which both products accept:

```toml
name = "chat"
compatibility_date = "2025-01-01"

[build]
command = "npm run build:pages"   # produce dist/ before every deploy

[assets]
directory = "./dist"              # what gets uploaded
not_found_handling = "single-page-application"
```

Verify locally without touching Cloudflare:

```bash
npx wrangler deploy --dry-run
# [custom build] … dist/ …
# ✨ Read 6 files from the assets directory /home/user/chat/dist
# --dry-run: exiting now.
```

That is the same code path Workers Builds takes: run `[build].command`, then upload `[assets].directory`.
When the Git integration re-runs on the next push it finds a real assets directory and the
`Missing entry-point` error is gone.

Notes:

* `dist/` stays gitignored — it is generated by `[build].command`, so nothing needs committing.
* Cloudflare "project name" and `name` in `wrangler.toml` should match (`chat` here). A mismatch only
  causes Wrangler to warn about deploying to a differently-named Worker.
* The Worker would serve `dist/` as static assets. There is no request handler, so this is the static
  shell only — same limits as Pages (§4 for pointing it at a Node backend).

## 2. Fix: a dedicated static build → `dist/`

```bash
npm run build:pages
```

This creates:

```
dist/
├── index.html      # asset URLs rewritten to ./css/… and ./js/… (relocatable)
├── css/app.css     # minified Tailwind bundle
├── js/app.js       # minified IIFE bundle (no source map, ~569 KB)
└── _headers        # long cache for assets, no-cache for the shell
```

`wrangler.toml` builds it (see §1a), and both targets consume the same config:

```toml
[build]
command = "npm run build:pages"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

`pages_build_output_dir` is deliberately **not** in the file: Wrangler refuses a config that contains
both that key and `[assets]` / `main` for Pages, and `wrangler deploy` ignores it entirely. Instead,
give Pages the output directory in its own settings — the dashboard fields in §3, or the explicit
path in `npm run pages:deploy` (`wrangler pages deploy dist`).

Local check before deploying:

```bash
npm run pages:dev      # wrangler pages dev dist → http://localhost:8788
npm run pages:deploy   # build + wrangler pages deploy dist
```

## 3. Deploy from the Cloudflare dashboard (Git integration)

| Setting | Value |
| --- | --- |
| Framework preset | None / Vite (does not matter) |
| **Build command** | `npm run build:pages` |
| **Build output directory** | `dist` |
| **Root directory** | repository root (leave blank) |

`Node version` ≥ 22 is required (`node:sqlite` is only used server-side, but the build scripts use
ESM and modern Node APIs). Add `NODE_VERSION=22` as a build environment variable if the default
image is older.

What went wrong in your log is exactly the missing build command: Wrangler ran with no directory of
assets. Adding `npm run build:pages` + `dist` removes the error.

## 3a. "Request failed (405)" on the join screen — what it means

If the deployed page shows the join screen but pressing **Enter chat** fails with
`Request failed (405)`, the UI is being served by the static host while the API calls are landing on
that same static host. A static server only serves files:

| Request | Static host answers | The app needs |
| --- | --- | --- |
| `GET /api/health` | `404`/`405` (Workers assets) or `index.html` (SPA fallback) | JSON `{ ok: true }` |
| `POST /api/auth/identify` | `405 Method Not Allowed` | a session cookie + device row |
| `POST /api/messages` | `405 Method Not Allowed` | SQLite write + broadcast |

Nothing is wrong with the deployment — there is simply no chat API in it. Pages/Workers cannot run
Express, Socket.io, `node:sqlite` or `uploads/`.

The client now detects this at boot (`client/lib/backendCheck.js` probes `/api/health`) and says so
instead of leaking a status code:

* red banner — *"This page is being served by a static host, which has no chat API behind it."*
* amber hint — how to fix it (`?backend=http://<server-ip>:3000`, or run `npm start`)
* **Enter chat** is disabled until a real backend answers, and pressing it re-probes, so starting the
  server and trying again works without a reload
* wrong `?backend=` values are reported, and the address being used is shown under the button

### Fix it in one of two ways

1. **Just deploy the Node app** (simplest — everything works):
   ```bash
   npm ci && npm start      # http://<lan-ip>:3000
   ```
2. **Keep the UI static and point it at a backend** — either
   * add `?backend=http://<server-ip>:3000` to the site URL once (remembered in `localStorage`), or
   * bake it into the build so visitors never see the banner:
     ```bash
     LAN_CHAT_BACKEND=http://192.168.1.24:3000 npm run build:pages
     ```
     (set it as a build environment variable in the Cloudflare dashboard and it applies to every
     deployment). Then allow the static origin on the backend: `ALLOWED_ORIGINS=…`,
     `COOKIE_SAMESITE=none` over HTTPS — see §4.

> The same banner appears for GitHub Pages, `python -m http.server`, or any other static file server.

## 4. Hybrid: Pages UI + Node backend

The client can talk to a backend on another origin. Configure it in one of three ways:

1. **Query parameter (no rebuild needed)** — handy for a live Pages site:
   `https://your-project.pages.dev/?backend=https://chat-api.example.com`
   The choice is remembered in `localStorage` and the parameter is stripped from the URL.
2. **Build-time global** — add a tiny `config.js` to `dist/` (and reference it from `index.html`):
   ```html
   <script>window.LAN_CHAT_BACKEND = 'https://chat-api.example.com';</script>
   ```
3. Nothing at all — same-origin, which is the normal self-hosted case.

On the backend (the Node host) allow the Pages origin and switch the cookie to cross-site:

```bash
ALLOWED_ORIGINS="https://your-project.pages.dev,https://<hash>.your-project.pages.dev"
COOKIE_SAMESITE=none      # requires HTTPS on the backend
npm start
```

What those do:

* `ALLOWED_ORIGINS` — explicit CORS allowlist for the API and Socket.io (`credentials: true`).
  Requests from other origins get no CORS headers at all; nothing is wildcarded.
* `COOKIE_SAMESITE=none` — sends the session cookie as `SameSite=None; Secure`, which is required
  for cross-site requests.
* `SEND_PASSWORD` — the per-message password (default `QW4hd`). It is verified by the backend, so the
  static UI cannot enforce it on its own: a Pages-only deployment has no backend to check it.

**Important caveat:** Safari blocks third-party cookies and Chrome restricts them in some contexts.
If the browser refuses to store the session cookie, the app now detects it, stops reconnecting, and
tells you so instead of hammering the backend. The robust fix is to serve the UI and the API from
the **same site** (for example `chat.example.com` on Pages with a `/api` proxy, or the Node app
served directly).

## 5. Alternatives that run the whole app

Because the interesting parts (realtime, SQLite, uploads) need a real Node process, the simple path
is a Node host, not Pages:

```bash
# any box on your network / a VPS
npm ci && npm run build && npm start
```

Or with Docker:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data", "/app/uploads"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
```

Mount volumes for `data/` and `uploads/` so the database and images survive restarts.

If you specifically want Cloudflare for realtime, that is a different architecture: Durable Objects
or WebSockets in a Worker, D1 for storage and R2 (or KV) for images. It is a rewrite of
`server/db.js`, `realtime.js` and `uploads.js` — not a deployment setting.

## 6. Checklist

- [ ] `git ls-tree -r --name-only origin/<deploy-branch>` lists the app, not just `README.md`
- [ ] Cloudflare has GitHub access to the repo, and the project's **production branch** is the branch
      that actually contains the code
- [ ] `npm run build:pages` produces `dist/index.html`, `dist/css/app.css`, `dist/js/app.js`
- [ ] Pages build command is `npm run build:pages`, output directory is `dist`
- [ ] `dist/index.html` references `./css/…` and `./js/…` (relative), not `/css/…`
- [ ] For hybrid: `ALLOWED_ORIGINS` on the backend lists the exact Pages origin(s), including
      preview deployments, and `COOKIE_SAMESITE=none` is set with HTTPS
- [ ] Open the deployed URL: the UI renders and the join screen appears
- [ ] Pressing **Enter chat** either joins, or explains that a static host has no API (it must not
      show a bare `Request failed (405)`)
- [ ] For hybrid: joining succeeds and a message sent from one tab appears in another
