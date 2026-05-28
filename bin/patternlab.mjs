#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const coreRoot = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);

const command = argv[0] ?? 'help';
const extraArgs = argv.slice(1);

const commandMap = {
  build: ['scripts/build.mjs', []],
  serve: ['scripts/serve.mjs', []],
  dev: ['scripts/serve.mjs', ['--watch', '--since-last-build']],
  'dev:full': ['scripts/serve.mjs', ['--watch']],
  'dev:styles': ['scripts/serve.mjs', ['--watch', '--styles']],
};

if (!commandMap[command]) {
  console.error('Usage: patternlab <build|serve|dev|dev:full|dev:styles> [args]');
  process.exit(1);
}

const [scriptRelPath, defaultArgs] = commandMap[command];
const scriptPath = path.join(coreRoot, scriptRelPath);
const child = spawnSync('node', [scriptPath, ...defaultArgs, ...extraArgs], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

if (typeof child.status === 'number') process.exit(child.status);
if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}
process.exit(0);
