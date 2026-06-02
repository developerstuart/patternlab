import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).version;

const runBuild = (...args) => {
  execFileSync('node', [path.join(repoRoot, 'scripts', 'build.mjs'), ...args], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
};

test('build renders components from flat folder structure', { concurrency: false }, () => {
  runBuild();

  const dist = path.join(repoRoot, 'dist');

  // Component "All" page: atoms/button aggregates every variation under headings
  const buttonHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button.html'), 'utf8');
  // Each section title is a link to the individual variation page
  assert.match(buttonHtml, /class="pl-variation__link"[^>]*data-pl-id="atoms\/button~default"[^>]*>Default</);
  assert.match(buttonHtml, /class="pl-variation__link"[^>]*data-pl-id="atoms\/button~ghost"[^>]*>Ghost</);
  assert.match(buttonHtml, /class="pl-variation__link"[^>]*data-pl-id="atoms\/button~outline"[^>]*>Outline</);
  assert.match(buttonHtml, /btn--primary/); // default render
  assert.match(buttonHtml, /btn--ghost/);   // ghost variation
  assert.match(buttonHtml, /btn--outline/); // outline variation

  // Standalone Default page (base-only render) still exists alongside "All"
  const defaultHtml = fs.readFileSync(path.join(dist, 'components', 'atoms', 'button~default.html'), 'utf8');
  assert.match(defaultHtml, /Primary action/);
  assert.match(defaultHtml, /btn--primary/);
  assert.doesNotMatch(defaultHtml, /btn--ghost/);

  // A component with no variations stays a single page (no synthetic default)
  assert.ok(!fs.existsSync(path.join(dist, 'components', 'molecules', 'feature-card~default.html')));

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
  assert.match(indexHtml, new RegExp(`v${packageVersion.replace(/\\./g, '\\\\.')}`));
  assert.match(indexHtml, /TREE/);
  assert.match(indexHtml, /id="variant-tabs"/);
  assert.match(indexHtml, /~default/);
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
  assert.ok(ids.includes('atoms/button~default'));
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

test('build merges global data from multiple src/data JSON files', { concurrency: false }, () => {
  const componentPath = path.join(repoRoot, 'src', 'components', 'atoms', 'global-data-test.twig');
  const dataAPath = path.join(repoRoot, 'src', 'data', 'z-test-site.json');
  const dataBPath = path.join(repoRoot, 'src', 'data', 'z-test-brand.json');
  fs.writeFileSync(componentPath, '<div>{{ site.name }} {{ brand.color }}</div>\n', 'utf8');
  fs.writeFileSync(dataAPath, JSON.stringify({ site: { name: 'Lab Test' } }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(dataBPath, JSON.stringify({ brand: { color: 'Blue' } }, null, 2) + '\n', 'utf8');

  try {
    runBuild();
    const html = fs.readFileSync(path.join(repoRoot, 'dist', 'components', 'atoms', 'global-data-test.html'), 'utf8');
    assert.match(html, /Lab Test Blue/);
  } finally {
    fs.rmSync(componentPath, { force: true });
    fs.rmSync(dataAPath, { force: true });
    fs.rmSync(dataBPath, { force: true });
    runBuild();
  }
});

test('build emits component source artifacts (code view)', { concurrency: false }, () => {
  runBuild();
  const codeDir = path.join(repoRoot, 'dist', 'code');

  // Base/All component: template + scss + js + data
  const button = JSON.parse(fs.readFileSync(path.join(codeDir, 'atoms', 'button.json'), 'utf8'));
  const types = button.files.map((f) => f.type);
  assert.ok(types.includes('template'));
  assert.ok(types.includes('scss'));
  assert.ok(types.includes('js'));
  assert.ok(types.includes('data'));
  const tpl = button.files.find((f) => f.type === 'template');
  assert.equal(tpl.name, 'button.twig');
  assert.equal(tpl.lang, 'twig');
  assert.match(tpl.content, /btn--primary|class="btn/);

  // Variation uses its own template + base data + variation data
  const ghost = JSON.parse(fs.readFileSync(path.join(codeDir, 'atoms', 'button~ghost.json'), 'utf8'));
  assert.equal(ghost.files.find((f) => f.type === 'template').name, 'button~ghost.twig');
  const ghostData = ghost.files.filter((f) => f.type === 'data').map((f) => f.name);
  assert.deepEqual(ghostData, ['button.json', 'button~ghost.json']);

  // Component with no JS file omits the js entry
  const tag = JSON.parse(fs.readFileSync(path.join(codeDir, 'atoms', 'tag.json'), 'utf8'));
  assert.ok(!tag.files.some((f) => f.type === 'js'));
});

test('code artifacts include variation-level scss/js', { concurrency: false }, () => {
  const ghostScss = path.join(repoRoot, 'src', 'components', 'atoms', 'button~ghost.scss');
  fs.writeFileSync(ghostScss, '.btn--ghost { opacity: 0.9; }\n', 'utf8');
  try {
    runBuild();
    const ghost = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'dist', 'code', 'atoms', 'button~ghost.json'), 'utf8'),
    );
    const scssNames = ghost.files.filter((f) => f.type === 'scss').map((f) => f.name);
    assert.deepEqual(scssNames, ['button.scss', 'button~ghost.scss']);
  } finally {
    fs.rmSync(ghostScss, { force: true });
    runBuild();
  }
});

test('variation .md sets order/title; component .md overrides default label', { concurrency: false }, () => {
  const dir = path.join(repoRoot, 'src', 'components', 'atoms');
  const ghostMd = path.join(dir, 'button~ghost.md');
  const buttonMd = path.join(dir, 'button.md');
  fs.writeFileSync(ghostMd, '---\norder: 0\ntitle: Spooky\n---\n', 'utf8');
  fs.writeFileSync(buttonMd, '---\ntitle: Button\ndefault_label: Primary\n---\n', 'utf8');
  try {
    runBuild();
    const tree = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'tree.json'), 'utf8'));
    const find = (n, id) => (n.id === id ? n : (n.children || []).reduce((a, c) => a || find(c, id), null));
    const button = find(tree, 'atoms/button');
    // Component title unchanged; default render relabelled via default_label
    assert.equal(button.label, 'Button');
    // order:0 first, then order:1 by title (Outline before Primary)
    assert.deepEqual(button.variations.map((v) => v.label), ['Spooky', 'Outline', 'Primary']);
  } finally {
    fs.rmSync(ghostMd, { force: true });
    fs.rmSync(buttonMd, { force: true });
    runBuild();
  }
});
