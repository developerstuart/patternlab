import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRuntimeContext } from './lib/runtime-context.mjs';
import { createHookRunner, loadPlugins } from './lib/plugins.mjs';
import { toPosix } from './lib/core/path.mjs';
import { createRecursiveWatcher } from './lib/serve/watchers.mjs';
import { createIncrementalRebuilder } from './lib/serve/incremental.mjs';
import { contentType, isTemplateExt, loadLiveReloadSnippet } from './lib/serve-utils.mjs';

const runtimeContext = createRuntimeContext({ scriptUrl: import.meta.url });
const { repoRoot, argv, patternlabConfig, client, paths } = runtimeContext;
const { srcRoot, componentsRoot, assetsRoot, distRoot } = paths;
const buildScript = path.join(repoRoot, 'scripts', 'build.mjs');
const port = Number(process.env.PORT || patternlabConfig.server?.port || 3000);
const watchMode = argv.includes('--watch');
const sinceLastBuildMode =
  argv.includes('--since-last-build') || argv.includes('--changed-components');
const LIVE_RELOAD_SNIPPET = loadLiveReloadSnippet(repoRoot);
const plugins = await loadPlugins(repoRoot, patternlabConfig.plugins);
const hooks = createHookRunner(plugins);

for (const warning of patternlabConfig._meta?.configWarnings ?? []) {
  console.warn(`[patternlab.config] ${warning}`);
}

const runBuild = (args = []) =>
  new Promise((resolve, reject) => {
    const childArgs = [buildScript, ...args];
    if (client) childArgs.push('--client', client);
    const child = spawn('node', childArgs, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Build exited with code ${code}`));
    });
  });

const clients = new Set();
const broadcastReload = () => {
  const data = `data: ${JSON.stringify({ type: 'reload' })}\n\n`;
  for (const res of clients) res.write(data);
};

const incremental = createIncrementalRebuilder({
  srcRoot,
  componentsRoot,
  assetsRoot,
  distRoot,
  isTemplateExt,
  runBuild,
  broadcastReload,
  toPosix,
  hooks,
  componentHeadPath: patternlabConfig.paths.componentHeadPath,
});

const watcher = createRecursiveWatcher({
  rootDir: srcRoot,
  onChange: incremental.queueChange,
});

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname === '/__live') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(':\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(distRoot, relativePath));

  if (!filePath.startsWith(distRoot)) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  if (watchMode && filePath.endsWith('.html')) {
    const html = fs.readFileSync(filePath, 'utf8');
    const injected = html.includes('</body>')
      ? html.replace('</body>', `${LIVE_RELOAD_SNIPPET}\n</body>`)
      : `${html}\n${LIVE_RELOAD_SNIPPET}`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(injected);
    return;
  }

  res.writeHead(200, { 'content-type': contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
});

const start = async () => {
  if (watchMode) {
    if (sinceLastBuildMode) {
      await runBuild(['--mode', 'modified-components']);
      console.log('Initial build: updated components modified since last build');
    } else {
      await runBuild([]);
    }
    watcher.refreshDirectoryWatchers();
    console.log(`Watching ${toPosix(path.relative(repoRoot, srcRoot))}/ for changes with incremental rebuilds`);
  }

  server.listen(port, () => {
    console.log(`Pattern Lab available at http://localhost:${port}`);
  });
};

process.on('SIGINT', () => {
  watcher.close();
  process.exit(0);
});

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
