/**
 * Development runner: rebuilds the client bundle and CSS whenever a source
 * file changes, and restarts the server when server files change.
 *
 *   npm run dev
 */
import { spawn } from 'node:child_process';
import { context } from 'esbuild';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ server */

let server = null;
function startServer() {
  if (server) server.kill('SIGTERM');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
}
startServer();

/* ------------------------------------------------------------------- client */

const esbuildContext = await context({
  entryPoints: [path.join(ROOT, 'client/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: path.join(ROOT, 'public/js/app.js'),
  sourcemap: true,
  logLevel: 'info',
});
await esbuildContext.watch();

const cssInput = path.join(ROOT, 'client/styles/tailwind.css');
const cssOutput = path.join(ROOT, 'public/css/app.css');
const { readFile, writeFile } = await import('node:fs/promises');

async function buildCss() {
  const source = await readFile(cssInput, 'utf8');
  const result = await postcss([tailwind(path.join(ROOT, 'tailwind.config.js')), autoprefixer]).process(source, {
    from: cssInput,
    to: cssOutput,
  });
  await writeFile(cssOutput, result.css);
  console.log(`[css] ${new Date().toLocaleTimeString()} rebuilt`);
}
await buildCss();

let cssTimer = null;
watch(path.join(ROOT, 'client'), { recursive: true }, (_event, file) => {
  if (file && !file.endsWith('.css')) return;
  clearTimeout(cssTimer);
  cssTimer = setTimeout(() => buildCss().catch(console.error), 60);
});
watch(path.join(ROOT, 'public/index.html'), () => {
  clearTimeout(cssTimer);
  cssTimer = setTimeout(() => buildCss().catch(console.error), 60);
});

/* -------------------------------------------------------- server restarts */

let restartTimer = null;
watch(path.join(ROOT, 'server'), { recursive: true }, (_event, file) => {
  if (!file?.endsWith('.js')) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log('[server] restarting…');
    startServer();
  }, 150);
});

const shutdown = () => {
  server?.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
