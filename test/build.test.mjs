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
    stdio: 'pipe',
  });
};

test('build renders components from flat folder structure', () => {
  runBuild();

  const dist = path.join(repoRoot, 'dist');

  // Base component: atoms/button
  const buttonHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button.html'), 'utf8');
  assert.match(buttonHtml, /Primary action/);
  assert.match(buttonHtml, /btn--primary/);

  // JSON-only variation: atoms/button~outline
  const outlineHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button~outline.html'), 'utf8');
  assert.match(outlineHtml, /Outline action/);
  assert.match(outlineHtml, /btn--outline/);

  // Template variation: atoms/button~ghost (own .twig + own .json)
  const ghostHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button~ghost.html'), 'utf8');
  assert.match(ghostHtml, /Ghost action/);
  assert.match(ghostHtml, /btn--ghost/);

  // Molecule with include
  const cardHtml = fs.readFileSync(path.join(dist, 'components', 'molecules', 'feature-card.html'), 'utf8');
  assert.match(cardHtml, /Modern Pattern Lab/);
  assert.match(cardHtml, /Learn more/);
  assert.match(cardHtml, /feature-card/);

  // app.css is generated and contains compiled button styles
  const css = fs.readFileSync(path.join(dist, 'app.css'), 'utf8');
  assert.match(css, /\.btn/);
  assert.match(css, /\.feature-card/);

  // index.html exists and contains the tree
  const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.match(indexHtml, /Pattern Lab/);
  assert.match(indexHtml, /TREE/);

  // tree.json has the folder hierarchy
  const tree = JSON.parse(fs.readFileSync(path.join(dist, 'tree.json'), 'utf8'));
  assert.equal(tree.type, 'folder');
  assert.ok(tree.children.some((c) => c.label === 'Atoms'));
  assert.ok(tree.children.some((c) => c.label === 'Molecules'));

  // components.json flat manifest
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'components.json'), 'utf8'));
  const ids = manifest.map((m) => m.id);
  assert.ok(ids.includes('atoms/button'));
  assert.ok(ids.includes('atoms/button~outline'));
  assert.ok(ids.includes('atoms/button~ghost'));
  assert.ok(ids.includes('molecules/feature-card'));

  // Variations are listed as type 'variation'
  const outlineEntry = manifest.find((m) => m.id === 'atoms/button~outline');
  assert.equal(outlineEntry.type, 'variation');
});
