import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const runBuild = () => {
  execFileSync('node', [path.join(repoRoot, 'scripts', 'build.mjs')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
};

test('build renders atomic and custom twig templates', () => {
  runBuild();

  const buttonHtml = fs.readFileSync(path.join(repoRoot, 'dist', 'components', 'atomic', 'atoms', 'button.html'), 'utf8');
  const featureHtml = fs.readFileSync(path.join(repoRoot, 'dist', 'components', 'custom', 'cards', 'feature.html'), 'utf8');
  const componentsIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'components.json'), 'utf8'));

  assert.match(buttonHtml, /Primary action/);
  assert.match(featureHtml, /Modern Pattern Lab/);
  assert.match(featureHtml, /Read component/);
  assert.equal(componentsIndex.length, 2);
  assert.deepEqual(
    componentsIndex.map((component) => component.type),
    ['atomic', 'custom']
  );
});
