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
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'css'), { recursive: true });
  await mkdir(path.join(DIST, 'js'), { recursive: true });

  // 1. Index shell: rewrite absolute asset paths so the app is relocatable.
  const indexHtml = await readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  const relocatable = indexHtml
    .replace('href="/css/app.css"', 'href="./css/app.css"')
    .replace('src="/js/app.js"', 'src="./js/app.js"');
  if (relocatable === indexHtml) {
    throw new Error('Could not rewrite asset paths in public/index.html — did the asset tags change?');
  }
  await writeFile(path.join(DIST, 'index.html'), relocatable);

  // 2. CSS (minified, same pipeline as the Node build).
  const cssSource = await readFile(path.join(ROOT, 'client/styles/tailwind.css'), 'utf8');
  const css = await postcss([tailwind(path.join(ROOT, 'tailwind.config.js')), autoprefixer]).process(cssSource, {
    from: path.join(ROOT, 'client/styles/tailwind.css'),
    to: path.join(DIST, 'css/app.css'),
  });
  await writeFile(path.join(DIST, 'css/app.css'), css.css);

  // 3. JS bundle — IIFE so it runs from a plain <script defer>.
  await build({
    entryPoints: [path.join(ROOT, 'client/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    sourcemap: false,
    outfile: path.join(DIST, 'js/app.js'),
    logLevel: 'warning',
  });

  // 4. Anything else that belongs to the static shell (icons, robots…).
  for (const extra of ['robots.txt', 'favicon.ico']) {
    await cp(path.join(ROOT, 'public', extra), path.join(DIST, extra)).catch(() => {});
  }

  await writeFile(
    path.join(DIST, '_headers'),
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: same-origin',
      '',
      '/css/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
      '/js/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
      '/index.html',
      '  Cache-Control: no-cache',
      '',
    ].join('\n'),
  );

  const [htmlSize, cssSize, jsSize] = await Promise.all([
    readFile(path.join(DIST, 'index.html')).then((b) => b.length),
    readFile(path.join(DIST, 'css/app.css')).then((b) => b.length),
    readFile(path.join(DIST, 'js/app.js')).then((b) => b.length),
  ]);

  console.log('✔ static bundle ready in dist/');
  console.log(`  index.html  ${(htmlSize / 1024).toFixed(1)} KB`);
  console.log(`  css/app.css ${(cssSize / 1024).toFixed(1)} KB`);
  console.log(`  js/app.js   ${(jsSize / 1024).toFixed(1)} KB`);
  console.log('\n  Static preview only — run `npm start` for the realtime backend.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
