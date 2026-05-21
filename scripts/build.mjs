import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const componentsRoot = path.join(repoRoot, 'src', 'components');
const distRoot = path.join(repoRoot, 'dist');
const outputComponentsRoot = path.join(distRoot, 'components');
const rendererPath = path.join(repoRoot, 'php', 'render.php');

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.name.endsWith('.twig') ? [fullPath] : [];
  });
};

const getContextPath = (templatePath) => templatePath.replace(/\.twig$/, '.json');

const renderTemplate = (templatePath) => {
  const contextPath = getContextPath(templatePath);
  const args = [rendererPath, '--template', templatePath, '--components-root', componentsRoot];

  if (fs.existsSync(contextPath)) {
    args.push('--context', contextPath);
  }

  return execFileSync('php', args, { encoding: 'utf8' });
};

const writeFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

const toPosix = (value) => value.split(path.sep).join('/');

const componentTemplates = walk(componentsRoot);

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(outputComponentsRoot, { recursive: true });

const components = componentTemplates.map((templatePath) => {
  const relativeTwigPath = path.relative(componentsRoot, templatePath);
  const relativeHtmlPath = relativeTwigPath.replace(/\.twig$/, '.html');
  const outputPath = path.join(outputComponentsRoot, relativeHtmlPath);
  const html = renderTemplate(templatePath);

  writeFile(outputPath, html);

  const folderType = relativeTwigPath.startsWith(`atomic${path.sep}`) ? 'atomic' : 'custom';

  return {
    name: path.basename(relativeTwigPath, '.twig'),
    type: folderType,
    source: toPosix(relativeTwigPath),
    output: toPosix(path.join('components', relativeHtmlPath))
  };
});

components.sort((a, b) => a.output.localeCompare(b.output));

writeFile(path.join(distRoot, 'components.json'), `${JSON.stringify(components, null, 2)}\n`);

const componentLinks = components
  .map((component) => `<li><button data-component="${component.output}">${component.type} / ${component.source}</button></li>`)
  .join('');

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pattern Lab</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; display: grid; grid-template-columns: 360px 1fr; min-height: 100vh; }
    aside { border-right: 1px solid #8884; padding: 1rem; overflow: auto; }
    h1 { margin-top: 0; font-size: 1.2rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
    button { width: 100%; text-align: left; border: 1px solid #8884; background: transparent; padding: 0.5rem; border-radius: 0.4rem; cursor: pointer; }
    main { padding: 1rem; }
    iframe { width: 100%; height: calc(100vh - 2rem); border: 1px solid #8884; border-radius: 0.4rem; background: white; }
  </style>
</head>
<body>
  <aside>
    <h1>Pattern Lab Components</h1>
    <p>Atomic + custom folders rendered from Twig via PHP.</p>
    <ul>${componentLinks}</ul>
  </aside>
  <main>
    <iframe id="preview" title="Component preview"></iframe>
  </main>
  <script>
    const preview = document.getElementById('preview');
    const buttons = [...document.querySelectorAll('button[data-component]')];
    const openComponent = (target) => {
      preview.src = target;
      history.replaceState({}, '', '?component=' + encodeURIComponent(target));
    };
    buttons.forEach((button) => {
      button.addEventListener('click', () => openComponent(button.dataset.component));
    });
    const initial = new URLSearchParams(window.location.search).get('component');
    const fallback = buttons[0]?.dataset.component;
    if (initial) {
      openComponent(initial);
    } else if (fallback) {
      openComponent(fallback);
    }
  </script>
</body>
</html>
`;

writeFile(path.join(distRoot, 'index.html'), indexHtml);

console.log(`Rendered ${components.length} component(s) into ${distRoot}`);
