import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPatternlabConfig } from '../scripts/lib/config.mjs';
import { createRuntimeContext } from '../scripts/lib/runtime-context.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const coreRoot = path.resolve(__dirname, '..');

const createConsumerRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patternlab-consumer-'));
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
  return root;
};

test('config resolves consumer paths from repoRoot and templates from coreRoot', () => {
  const consumerRoot = createConsumerRoot();
  const cfg = loadPatternlabConfig({ repoRoot: consumerRoot, coreRoot });

  assert.equal(cfg.paths.srcRoot, path.join(consumerRoot, 'src'));
  assert.equal(cfg.paths.componentsRoot, path.join(consumerRoot, 'src', 'components'));
  assert.equal(cfg.paths.templatesRoot, path.join(coreRoot, 'scripts', 'templates'));
  assert.equal(cfg._meta.configPath, 'patternlab.config.json');
});

test('runtime context respects --root and --config overrides', () => {
  const consumerRoot = createConsumerRoot();
  const configPath = path.join(consumerRoot, 'config', 'patternlab.alt.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ title: 'Alt Config' }, null, 2));

  const runtime = createRuntimeContext({
    scriptUrl: pathToFileURL(path.join(coreRoot, 'scripts', 'serve.mjs')).href,
    argv: ['--root', consumerRoot, '--config', configPath],
    env: {},
    cwd: coreRoot,
  });

  assert.equal(runtime.repoRoot, consumerRoot);
  assert.equal(runtime.configPath, configPath);
  assert.equal(runtime.patternlabConfig.title, 'Alt Config');
  assert.equal(runtime.coreRoot, coreRoot);
});

test('runtime context supports PATTERNLAB_ROOT and PATTERNLAB_CONFIG', () => {
  const consumerRoot = createConsumerRoot();
  const configPath = path.join(consumerRoot, 'patternlab.custom.json');
  fs.writeFileSync(configPath, JSON.stringify({ title: 'Env Config' }, null, 2));

  const runtime = createRuntimeContext({
    scriptUrl: pathToFileURL(path.join(coreRoot, 'scripts', 'build.mjs')).href,
    argv: [],
    env: {
      PATTERNLAB_ROOT: consumerRoot,
      PATTERNLAB_CONFIG: configPath,
    },
    cwd: coreRoot,
  });

  assert.equal(runtime.repoRoot, consumerRoot);
  assert.equal(runtime.configPath, configPath);
  assert.equal(runtime.patternlabConfig.title, 'Env Config');
});
