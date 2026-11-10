/**
 * Builds a self-contained static bundle for Cloudflare Pages (or any static
 * host) into `dist/`.
 *
 * Differences from the Node build in `public/`:
 *  - asset URLs are relative (`./css/app.css`), so the app works at any origin,
 *    including Cloudflare Pages preview deployments and a bare `file://` open;
 *  - source maps are dropped (they are not useful in production and Pages has a
 *    25 MiB per-file limit);
 *  - a small `_headers` file adds sensible caching for the hashed bundle and
 *    `no-store` for the HTML shell.
 *
 * NOTE: Pages only serves static files. The realtime server, SQLite storage and
 * image uploads still need the Node process — see docs/DEPLOY-CLOUDFLARE.md.
 *
 *   npm run build:pages
 */
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Short content hash used for cache-busting asset filenames. */
const hash = (contents) => createHash('sha256').update(contents).digest('hex').slice(0, 10);

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'css'), { recursive: true });
  await mkdir(path.join(DIST, 'js'), { recursive: true });

  // 1. Build the assets first, so the HTML can reference their real content hashes.
  //    Names like /js/app.<hash>.js are what make long-lived caching safe: a new
  //    deploy produces a new URL, so a cached bundle can never outlive its code.
  //    (Before this, the bundle was /js/app.js with a one-year `immutable` header —
  //    a browser would keep serving old JavaScript for a year after a deploy.)

  // 1a. CSS (minified, same pipeline as the Node build).
  const cssSource = await readFile(path.join(ROOT, 'client/styles/tailwind.css'), 'utf8');
  const css = await postcss([tailwind(path.join(ROOT, 'tailwind.config.js')), autoprefixer]).process(cssSource, {
    from: path.join(ROOT, 'client/styles/tailwind.css'),
    to: path.join(DIST, 'css/app.css'),
  });
  const cssFile = `app.${hash(css.css)}.css`;
  await writeFile(path.join(DIST, 'css', cssFile), css.css);

  // 1b. JS bundle — IIFE so it runs from a plain <script defer>.
  const jsPath = path.join(DIST, 'js', 'app.bundle.js');
  await build({
    entryPoints: [path.join(ROOT, 'client/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    sourcemap: false,
    outfile: jsPath,
    logLevel: 'warning',
  });
  const jsSource = await readFile(jsPath, 'utf8');
  const jsFile = `app.${hash(jsSource)}.js`;
  await rm(jsPath, { force: true });
  await writeFile(path.join(DIST, 'js', jsFile), jsSource);

  // Transitional alias: browsers that cached the *old* shell still ask for
  // /js/app.js. Serving them the current bundle (rather than letting the SPA
  // fallback answer with HTML, which is a script syntax error) lets those caches
  // heal instead of showing a blank page. New shells never reference this path.
  await writeFile(path.join(DIST, 'js', 'app.js'), jsSource);

  // 2. Index shell: relative, hashed asset URLs so the app is relocatable.
  const indexHtml = await readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  let relocatable = indexHtml
    .replace('href="/css/app.css"', `href="./css/${cssFile}"`)
    .replace('src="/js/app.js"', `src="./js/${jsFile}"`);
  if (relocatable === indexHtml) {
    throw new Error('Could not rewrite asset paths in public/index.html — did the asset tags change?');
  }

  // 2b. Optional backend hint: `LAN_CHAT_BACKEND=https://api.example.com npm run build:pages`
  //     bakes the Node server's address into the static shell, so visitors do not
  //     need a ?backend= query parameter and the join screen can never end up
  //     posting to a static host by accident.
  const backend = (process.env.LAN_CHAT_BACKEND || '').trim().replace(/\/+$/, '');
  if (backend && !/^https?:\/\/[^/\s]+$/i.test(backend)) {
    throw new Error(`LAN_CHAT_BACKEND must be an absolute http(s) URL, got "${backend}"`);
  }
  if (backend) {
    const tag = `<script>window.LAN_CHAT_BACKEND = ${JSON.stringify(backend)};</script>\n    `;
    relocatable = relocatable.replace(`<script defer src="./js/${jsFile}">`, `${tag}<script defer src="./js/${jsFile}">`);
  }
  await writeFile(path.join(DIST, 'index.html'), relocatable);

  // 4. Anything else that belongs to the static shell (icons, robots…).
  for (const extra of ['robots.txt', 'favicon.ico']) {
    await cp(path.join(ROOT, 'public', extra), path.join(DIST, extra)).catch(() => {});
  }

  // Assets carry a content hash in their name, so they can be cached forever.
  // The HTML shell is what changes between deploys: it must always be revalidated,
  // and the `=./css/…` reference is relative, so the same shell works anywhere.
  await writeFile(
    path.join(DIST, '_headers'),
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: same-origin',
      '',
      // Hashed names only (`app.<hash>.js`). The bare `/js/app.js` alias does not
      // match, so it keeps its revalidating rule instead of inheriting `immutable`
      // (Cloudflare concatenates every matching rule, and "immutable, no-cache" is
      // a contradiction).
      '/css/app.*.css',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
      '/js/app.*.js',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
      '/js/app.js',
      '  Cache-Control: no-cache, must-revalidate',
      '',
      '/index.html',
      '  Cache-Control: no-cache, must-revalidate',
      '',
      '/',
      '  Cache-Control: no-cache, must-revalidate',
      '',
    ].join('\n'),
  );

  const [htmlSize, cssSize, jsSize] = await Promise.all([
    readFile(path.join(DIST, 'index.html')).then((b) => b.length),
    readFile(path.join(DIST, 'css', cssFile)).then((b) => b.length),
    readFile(path.join(DIST, 'js', jsFile)).then((b) => b.length),
  ]);

  console.log('✔ static bundle ready in dist/');
  console.log(`  index.html   ${(htmlSize / 1024).toFixed(1)} KB`);
  console.log(`  css/${cssFile} ${(cssSize / 1024).toFixed(1)} KB`);
  console.log(`  js/${jsFile}   ${(jsSize / 1024).toFixed(1)} KB`);
  if (backend) {
    console.log(`\n  Backend baked in: ${backend}`);
  }
  console.log('\n  Static preview only — run `npm start` for the realtime backend.');
  console.log('  Without a reachable backend the join screen explains how to point at one.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
