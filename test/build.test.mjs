import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const runBuild = (...args) => {
  execFileSync('node', [path.join(repoRoot, 'scripts', 'build.mjs'), ...args], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
};

test('build renders components from flat folder structure', { concurrency: false }, () => {
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
  assert.match(indexHtml, /data-size="desktop"/);
  assert.match(indexHtml, /data-resize="right"/);

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

test('build injects optional custom component head markup', { concurrency: false }, () => {
  const customHeadPath = path.join(repoRoot, 'src', '_component-head.html');
  fs.writeFileSync(customHeadPath, '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">', 'utf8');
  try {
    runBuild();

    const dist = path.join(repoRoot, 'dist');
    const buttonHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button.html'), 'utf8');
    assert.match(buttonHtml, /https:\/\/fonts\.googleapis\.com\/css2\?family=Inter/);
    assert.match(buttonHtml, /<link rel="stylesheet" href="\/app\.css">/);
    assert.match(buttonHtml, /<script src="\/app\.js" defer><\/script>/);
  } finally {
    fs.rmSync(customHeadPath, { force: true });
  }
});

test('build styles mode refreshes app.css without full rebuild', { concurrency: false }, () => {
  const scssPath = path.join(repoRoot, 'src', 'components', 'atoms', 'button.scss');
  const original = fs.readFileSync(scssPath, 'utf8');
  try {
    runBuild();
    fs.writeFileSync(scssPath, `${original}\n.__style-mode-test{color:#123456;}\n`, 'utf8');
    runBuild('--mode', 'styles');
    const css = fs.readFileSync(path.join(repoRoot, 'dist', 'app.css'), 'utf8');
    assert.match(css, /__style-mode-test/);
  } finally {
    fs.writeFileSync(scssPath, original, 'utf8');
    runBuild('--mode', 'styles');
  }
});

test('build component mode rerenders only affected component pages', { concurrency: false }, () => {
  const jsonPath = path.join(repoRoot, 'src', 'components', 'atoms', 'button.json');
  const original = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  try {
    runBuild();
    fs.writeFileSync(jsonPath, JSON.stringify({ ...original, type: 'submit' }, null, 2) + '\n', 'utf8');
    runBuild('--mode', 'component', '--source', 'atoms/button.json');
    const dist = path.join(repoRoot, 'dist');
    const buttonHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button.html'), 'utf8');
    const outlineHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button~outline.html'), 'utf8');
    assert.match(buttonHtml, /type="submit"/);
    assert.match(outlineHtml, /type="submit"/);
  } finally {
    fs.writeFileSync(jsonPath, JSON.stringify(original, null, 2) + '\n', 'utf8');
    runBuild('--mode', 'component', '--source', 'atoms/button.json');
  }
});
