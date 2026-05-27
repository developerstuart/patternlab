import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPatternlabConfig } from '../scripts/lib/config.mjs';
import { createHookRunner, loadPlugins } from '../scripts/lib/plugins.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

test('config exposes expanded skeleton surface for defaults', () => {
  const cfg = loadPatternlabConfig(repoRoot);
  assert.equal(cfg.paths.srcRoot, path.join(repoRoot, 'src'));
  assert.equal(cfg.paths.componentsRoot, path.join(repoRoot, 'src', 'components'));
  assert.equal(cfg.ui.showModeToggle, true);
  assert.equal(cfg.output.componentsDir, 'components');
  assert.equal(cfg.templating.engines['.twig'], 'twig');
  assert.ok(Array.isArray(cfg.plugins));
});

test('plugin hooks run in order and can transform payload', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patternlab-plugin-'));
  const pluginPath = path.join(tmpRoot, 'plugin.mjs');
  fs.writeFileSync(
    pluginPath,
    `export default {
      beforeBuild(payload){ return { ...payload, stage: 'before' }; },
      afterBuild(payload){ return { ...payload, done: true }; }
    };`,
  );

  const loaded = await loadPlugins(tmpRoot, ['plugin.mjs']);
  const hooks = createHookRunner(loaded);
  const before = await hooks.run('beforeBuild', { stage: 'init' });
  const after = await hooks.run('afterBuild', { stage: 'before' });
  assert.equal(before.stage, 'before');
  assert.equal(after.done, true);
});
