import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const componentsRoot = path.join(srcRoot, "components");
const assetsRoot = path.join(srcRoot, "assets");
const distRoot = path.join(repoRoot, "dist");
const phpRenderer = path.join(repoRoot, "php", "render.php");

const argv = process.argv.slice(2);
const getArgValue = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
};
const buildMode = getArgValue("--mode") ?? "full"; // full | styles | component
const changedSource = getArgValue("--source");

// ─── Supported template engines ───────────────────────────────────────────────

const TEMPLATE_EXTS = new Map([
  [".twig", "twig"],
  [".mustache", "mustache"],
  [".njk", "nunjucks"],
  [".liquid", "liquid"],
  [".hbs", "handlebars"],
  [".html", "html"],
]);

// ─── Utilities ────────────────────────────────────────────────────────────────

const toPosix = (v) => v.split(path.sep).join("/");

const writeFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
};

const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
};

// Minimal YAML frontmatter parser (key: value pairs only)
const parseFrontmatter = (raw) => {
  const m = raw.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/,
  );
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (val !== "" && !Number.isNaN(Number(val))) val = Number(val);
    if (key) meta[key] = val;
  }
  return { meta, body: m[2] };
};

const readMeta = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  return parseFrontmatter(fs.readFileSync(filePath, "utf8")).meta;
};

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readText = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

const mergeDeep = (...objs) => {
  const result = {};
  for (const obj of objs) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) {
      if (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof result[k] === "object" &&
        result[k] !== null &&
        !Array.isArray(result[k])
      ) {
        result[k] = mergeDeep(result[k], v);
      } else {
        result[k] = v;
      }
    }
  }
  return result;
};

const toLabel = (stem) =>
  stem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ─── Rendering engines ────────────────────────────────────────────────────────

// Lazy module cache
const engines = {};

const renderTemplate = async (templatePath, engine, context) => {
  const template = fs.readFileSync(templatePath, "utf8");

  if (engine === "twig") {
    const tmpCtx = path.join(distRoot, "_ctx.json");
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(tmpCtx, JSON.stringify(context), "utf8");
    const args = [
      phpRenderer,
      "--template",
      templatePath,
      "--components-root",
      componentsRoot,
      "--context",
      tmpCtx,
    ];
    const html = execFileSync("php", args, { encoding: "utf8" });
    fs.rmSync(tmpCtx, { force: true });
    return html;
  }

  if (engine === "mustache") {
    if (!engines.mustache)
      engines.mustache = (await import("mustache")).default;
    return engines.mustache.render(template, context);
  }

  if (engine === "nunjucks") {
    if (!engines.nunjucks) engines.nunjucks = await import("nunjucks");
    const { nunjucks } = engines;
    const env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(componentsRoot),
      { autoescape: true },
    );
    const rel = toPosix(path.relative(componentsRoot, templatePath));
    return env.render(rel, context);
  }

  if (engine === "liquid") {
    if (!engines.liquid) {
      const { Liquid } = await import("liquidjs");
      engines.liquid = new Liquid({ root: componentsRoot, extname: ".liquid" });
    }
    return engines.liquid.renderFile(
      toPosix(path.relative(componentsRoot, templatePath)),
      context,
    );
  }

  if (engine === "handlebars") {
    // Use mustache for basic handlebars compatibility
    if (!engines.mustache)
      engines.mustache = (await import("mustache")).default;
    return engines.mustache.render(template, context);
  }

  // html: pass through as-is
  return template;
};

const buildComponentHead = (extraHead = "") => {
  const trimmedExtra = extraHead.trim();
  const extra = trimmedExtra ? `\n${trimmedExtra}\n` : "\n";
  return `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>(function(){var t=localStorage.getItem('pl-theme');if(t==='dark'||(t==null&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark');})()</script>
  <link rel="stylesheet" href="/app.css">${extra}  <script src="/app.js" defer></script>`;
};

// Wrap rendered body in a minimal HTML page that includes app.css / app.js
const wrapComponent = (body, extraHead = "") => `<!doctype html>
<html lang="en">
<head>
${buildComponentHead(extraHead)}
</head>
<body>
${body}
<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'pl-theme') {
    document.documentElement.setAttribute('data-theme', e.data.theme);
    localStorage.setItem('pl-theme', e.data.theme);
  }
});
</script>
</body>
</html>`;

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Recursively discover a folder, returning a tree node.
 * Each folder node collects:
 *   - children: sub-folder nodes + component nodes
 *   - _scss / _js: style and script files to bundle
 */
const discoverDir = (dir, relPath, parentGlobal) => {
  if (!fs.existsSync(dir)) return null;

  const folderMeta = readMeta(path.join(dir, "_meta.md"));
  const folderGlobal = mergeDeep(
    parentGlobal,
    readJson(path.join(dir, "_global.json")) ?? {},
  );

  // Scan directory entries
  const templateFiles = new Map(); // stem → { fullPath, engine }
  const jsonStems = new Set(); // stems that have a .json file
  const scssFiles = [];
  const jsFiles = [];
  const subDirs = [];

  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith("_") || entry.name === ".gitkeep") continue;
    const fullPath = path.join(dir, entry.name);
    const ext = path.extname(entry.name);
    const stem = path.basename(entry.name, ext);

    if (entry.isDirectory()) {
      subDirs.push({ name: entry.name, fullPath });
      continue;
    }

    if (TEMPLATE_EXTS.has(ext)) {
      templateFiles.set(stem, { fullPath, engine: TEMPLATE_EXTS.get(ext) });
    } else if (ext === ".json") {
      jsonStems.add(stem);
    } else if (ext === ".scss") {
      scssFiles.push(fullPath);
    } else if (ext === ".js") {
      jsFiles.push(fullPath);
    }
    // .md files alongside components are read on-demand below
  }

  // Group into base components and variations
  const bases = new Map(); // baseStem → base info

  for (const [stem, tmpl] of templateFiles) {
    if (stem.includes("~")) continue; // variation templates handled below
    const compMeta = readMeta(path.join(dir, `${stem}.md`));
    bases.set(stem, {
      templatePath: tmpl.fullPath,
      engine: tmpl.engine,
      jsonPath: jsonStems.has(stem) ? path.join(dir, `${stem}.json`) : null,
      meta: compMeta,
      variations: new Map(),
    });
  }

  // Attach variation templates
  for (const [stem, tmpl] of templateFiles) {
    if (!stem.includes("~")) continue;
    const tilde = stem.indexOf("~");
    const baseStem = stem.slice(0, tilde);
    const varName = stem.slice(tilde + 1);
    if (!bases.has(baseStem)) continue;
    bases.get(baseStem).variations.set(varName, {
      templatePath: tmpl.fullPath,
      engine: tmpl.engine,
      jsonPath: jsonStems.has(stem) ? path.join(dir, `${stem}.json`) : null,
    });
  }

  // Attach JSON-only variations (no matching variation template)
  for (const stem of jsonStems) {
    if (!stem.includes("~")) continue;
    const tilde = stem.indexOf("~");
    const baseStem = stem.slice(0, tilde);
    const varName = stem.slice(tilde + 1);
    if (!bases.has(baseStem)) continue;
    if (bases.get(baseStem).variations.has(varName)) continue; // already has template
    const base = bases.get(baseStem);
    base.variations.set(varName, {
      templatePath: base.templatePath,
      engine: base.engine,
      jsonPath: path.join(dir, `${stem}.json`),
    });
  }

  // Build component nodes
  const componentNodes = [];
  for (const [stem, base] of bases) {
    if (base.meta.hidden) continue;
    const compId = relPath ? `${relPath}/${stem}` : stem;
    const outBase = toPosix(path.join("components", relPath || "", stem));

    const varNodes = [];
    for (const [varName, varData] of base.variations) {
      const varId = `${compId}~${varName}`;
      const varOut = `${outBase}~${varName}.html`;
      varNodes.push({
        type: "variation",
        id: varId,
        label: toLabel(varName),
        outputPath: varOut,
        _render: {
          templatePath: varData.templatePath,
          engine: varData.engine,
          baseJsonPath: base.jsonPath,
          varJsonPath: varData.jsonPath,
          globalData: folderGlobal,
        },
      });
    }

    componentNodes.push({
      type: "component",
      id: compId,
      label: base.meta.title ?? toLabel(stem),
      order: base.meta.order ?? 999,
      hidden: false,
      outputPath: `${outBase}.html`,
      variations: varNodes,
      _render: {
        templatePath: base.templatePath,
        engine: base.engine,
        baseJsonPath: base.jsonPath,
        varJsonPath: null,
        globalData: folderGlobal,
      },
    });
  }

  // Build sub-folder nodes
  const folderNodes = [];
  for (const { name, fullPath } of subDirs) {
    const childRel = relPath ? `${relPath}/${name}` : name;
    const child = discoverDir(fullPath, childRel, folderGlobal);
    if (child && !child.hidden && child.children.length > 0)
      folderNodes.push(child);
  }

  // Sort components: by order then alphabetically
  componentNodes.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
  folderNodes.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });

  return {
    type: "folder",
    id: relPath || "__root__",
    label: folderMeta.title ?? toLabel(path.basename(dir)),
    order: folderMeta.order ?? 999,
    hidden: folderMeta.hidden ?? false,
    folderPath: relPath || "",
    children: [...folderNodes, ...componentNodes],
    _scss: scssFiles,
    _js: jsFiles,
  };
};

// ─── Flatten helpers ──────────────────────────────────────────────────────────

const flattenRenderables = (node) => {
  const out = [];
  if (node.type === "component") {
    out.push(node);
    for (const v of node.variations ?? []) out.push(v);
  } else {
    for (const child of node.children ?? [])
      out.push(...flattenRenderables(child));
  }
  return out;
};

const collectStyleAssets = (node, scss = [], js = []) => {
  if (node._scss) scss.push(...node._scss);
  if (node._js) js.push(...node._js);
  for (const child of node.children ?? []) collectStyleAssets(child, scss, js);
  return { scss, js };
};

const resolveAffectedComponentIds = (sourceRelPath, renderables) => {
  const normalized = toPosix(sourceRelPath || "").replace(/^\/+/, "");
  if (!normalized) return [];
  const ext = path.posix.extname(normalized);
  const supported = new Set([
    ".twig",
    ".mustache",
    ".njk",
    ".liquid",
    ".hbs",
    ".html",
    ".json",
  ]);
  if (!supported.has(ext)) return [];

  const stem = path.posix.basename(normalized, ext);
  if (!stem || stem.startsWith("_")) return [];
  const dir = path.posix.dirname(normalized);
  const prefix = dir && dir !== "." ? `${dir}/` : "";

  if (stem.includes("~")) {
    return [`${prefix}${stem}`];
  }

  const baseId = `${prefix}${stem}`;
  return renderables
    .map((item) => item.id)
    .filter((id) => id === baseId || id.startsWith(`${baseId}~`));
};

// ─── SCSS / JS pipeline ───────────────────────────────────────────────────────

const buildCss = async (scssFiles) => {
  if (scssFiles.length === 0) return "";
  const combined = scssFiles
    .map(
      (f) =>
        `/* ${toPosix(path.relative(srcRoot, f))} */\n${fs.readFileSync(f, "utf8")}`,
    )
    .join("\n\n");
  try {
    const sassModule = await import("sass");
    const sass =
      typeof sassModule.compile === "function"
        ? sassModule
        : sassModule.default;
    if (!sass || typeof sass.compile !== "function") {
      throw new Error("Sass compiler API not found");
    }

    const compiled = scssFiles.map((filePath) => {
      const result = sass.compile(filePath, {
        loadPaths: [componentsRoot, srcRoot],
        style: "expanded",
      });
      return `/* ${toPosix(path.relative(srcRoot, filePath))} */\n${result.css}`;
    });
    return compiled.join("\n\n");
  } catch (err) {
    console.warn(
      `Sass compile failed; using raw concatenated styles. ${err?.message ?? ""}`.trim(),
    );
    return combined; // fallback: return raw SCSS/CSS concatenation
  }
};

const buildJs = (jsFiles) =>
  jsFiles.length === 0
    ? ""
    : jsFiles
        .map(
          (f) =>
            `/* ${toPosix(path.relative(srcRoot, f))} */\n${fs.readFileSync(f, "utf8")}`,
        )
        .join("\n\n");

// ─── Strip internal _* fields before serialising ──────────────────────────────

const stripPrivate = (node) => {
  const { _render, _scss, _js, ...rest } = node;
  if (rest.children) rest.children = rest.children.map(stripPrivate);
  if (rest.variations) rest.variations = rest.variations.map(stripPrivate);
  return rest;
};

// ─── Render a single component or variation ────────────────────────────────────

const renderItem = async (item, componentHeadExtra) => {
  const { templatePath, engine, baseJsonPath, varJsonPath, globalData } =
    item._render;
  const baseData = baseJsonPath ? (readJson(baseJsonPath) ?? {}) : {};
  const varData = varJsonPath ? (readJson(varJsonPath) ?? {}) : {};
  const context = mergeDeep(globalData, baseData, varData);
  const body = await renderTemplate(templatePath, engine, context);
  return wrapComponent(body, componentHeadExtra);
};

// ─── UI HTML ─────────────────────────────────────────────────────────────────

const buildIndexHtml = (publicTree, totalCount) => {
  const safeTree = JSON.stringify(publicTree).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pattern Lab</title>
  <script>
    (function(){
      var t=localStorage.getItem('pl-theme');
      if(t==='dark'||(t==null&&matchMedia('(prefers-color-scheme:dark)').matches))
        document.documentElement.setAttribute('data-theme','dark');
    })();
  </script>
  <style>
    /* ── Variables ───────────────────────── */
    :root {
      --bg:#ffffff; --surface:#f4f4f5; --surface2:#e4e4e7;
      --border:rgba(0,0,0,.10); --text:#18181b; --text-muted:#71717a;
      --accent:#2563eb; --accent-fg:#ffffff;
      --sidebar-w:268px; --header-h:48px; --radius:6px;
      --font:ui-sans-serif,system-ui,-apple-system,sans-serif;
    }
    [data-theme="dark"] {
      --bg:#09090b; --surface:#18181b; --surface2:#27272a;
      --border:rgba(255,255,255,.08); --text:#fafafa; --text-muted:#a1a1aa;
      --accent:#60a5fa; --accent-fg:#0c1929;
    }
    /* ── Reset ───────────────────────────── */
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;font-family:var(--font);background:var(--bg);color:var(--text);
      display:grid;grid-template-rows:var(--header-h) 1fr;
      grid-template-columns:var(--sidebar-w) 1fr;height:100vh;overflow:hidden}
    button{font-family:var(--font);cursor:pointer}
    /* ── Header ───────────────────────────── */
    header{grid-column:1/-1;display:flex;align-items:center;gap:.75rem;
      padding:0 1rem;background:var(--surface);border-bottom:1px solid var(--border);z-index:10}
    header h1{margin:0;font-size:.95rem;font-weight:700;letter-spacing:-.01em}
    .count{font-size:.78rem;color:var(--text-muted)}
    .spacer{flex:1}
    /* ── Sidebar ─────────────────────────── */
    aside{overflow-y:auto;border-right:1px solid var(--border);
      background:var(--surface);padding:.375rem 0}
    /* ── Tree ────────────────────────────── */
    .tree{list-style:none;margin:0;padding:0}
    .tree-btn{display:flex;align-items:center;gap:.35rem;width:100%;text-align:left;
      background:none;border:none;padding:.28rem .75rem;font-family:var(--font);
      font-size:.8rem;color:var(--text);transition:background .1s}
    .tree-btn:hover{background:var(--surface2)}
    .tree-btn.active{background:var(--accent);color:var(--accent-fg)}
    .tree-btn .icon{flex-shrink:0;width:1em;text-align:center;opacity:.5;font-size:.65em;transition:opacity .15s}
    .tree-btn:hover .icon,.tree-btn.active .icon{opacity:1}
    .tree-btn .lbl{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .tree-folder>.tree-btn{font-weight:600;font-size:.72rem;text-transform:uppercase;
      letter-spacing:.05em;color:var(--text-muted)}
    .tree-folder>.tree-btn:hover{color:var(--text)}
    .tree-folder>.tree-btn.active{color:var(--accent-fg)}
    .tree-children{display:none;padding-left:.5rem;border-left:1px solid var(--border);margin-left:1.1rem}
    .tree-item.open>.tree-children{display:block}
    .tree-variation>.tree-btn{font-size:.75rem;color:var(--text-muted);font-style:italic}
    .tree-variation>.tree-btn.active{color:var(--accent-fg);font-style:normal}
    /* ── Main ────────────────────────────── */
    main{overflow:hidden;display:flex;flex-direction:column}
    .main-toolbar{display:flex;align-items:center;gap:.5rem;padding:.3rem .75rem;
      border-bottom:1px solid var(--border);min-height:36px;font-size:.8rem;flex-wrap:wrap}
    .breadcrumb{color:var(--text);font-weight:500}
    .main-content{flex:1;overflow:auto;position:relative}
    #preview-host{width:100%;height:100%;padding:.75rem;display:flex;align-items:flex-start;justify-content:center;overflow:auto}
    #preview-shell{position:relative;width:100%;height:100%;min-width:280px;min-height:220px;max-width:100%;max-height:100%;
      border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--bg)}
    #preview-frame{width:100%;height:100%;border:none;display:block;background:var(--bg)}
    .resize-handle{position:absolute;z-index:2;background:transparent}
    .handle-right{top:0;right:0;width:8px;height:100%;cursor:ew-resize}
    .handle-bottom{left:0;bottom:0;width:100%;height:8px;cursor:ns-resize}
    .handle-corner{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize}
    .viewport-tools{display:flex;align-items:center;gap:.25rem}
    .size-btn{background:none;border:1px solid var(--border);border-radius:var(--radius);
      padding:.2rem .5rem;color:var(--text);font-size:.75rem}
    .size-btn:hover{background:var(--surface2)}
    .size-btn.active{background:var(--accent);color:var(--accent-fg);border-color:transparent}
    /* ── Folder view ─────────────────────── */
    #folder-view{padding:1rem;display:grid;
      grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
    .ccard{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--surface)}
    .ccard-hd{display:flex;align-items:center;gap:.5rem;padding:.35rem .75rem;
      border-bottom:1px solid var(--border);font-size:.78rem;font-weight:500}
    .ccard-hd .open-btn{margin-left:auto;font-size:.7rem;background:var(--accent);color:var(--accent-fg);
      border:none;border-radius:4px;padding:.15rem .45rem;cursor:pointer}
    .ccard-vars{display:flex;gap:.25rem;flex-wrap:wrap;padding:.25rem .75rem;
      border-bottom:1px solid var(--border)}
    .var-btn{font-size:.7rem;background:var(--surface2);color:var(--text-muted);
      border:1px solid var(--border);border-radius:4px;padding:.1rem .4rem;cursor:pointer;font-family:var(--font)}
    .var-btn:hover{color:var(--text)}
    .ccard iframe{width:100%;height:180px;border:none;display:block}
    /* ── Utility buttons ─────────────────── */
    .icon-btn{background:none;border:1px solid var(--border);border-radius:var(--radius);
      padding:.25rem .55rem;color:var(--text);font-size:.78rem;transition:background .1s}
    .icon-btn:hover{background:var(--surface2)}
    .empty{display:flex;align-items:center;justify-content:center;height:100%;
      color:var(--text-muted);font-size:.9rem}
  </style>
</head>
<body>

<header>
  <h1>Pattern Lab</h1>
  <span class="count">${totalCount} component${totalCount !== 1 ? "s" : ""}</span>
  <div class="spacer"></div>
  <button class="icon-btn" id="theme-btn" aria-label="Toggle dark mode">🌙 Dark</button>
</header>

<aside>
  <nav aria-label="Components">
    <ul class="tree" id="tree-root"></ul>
  </nav>
</aside>

<main>
  <div class="main-toolbar">
    <span id="breadcrumb" class="breadcrumb"></span>
    <div class="spacer"></div>
    <div class="viewport-tools" id="viewport-tools" style="display:none">
      <button class="size-btn" data-size="full">Full</button>
      <button class="size-btn" data-size="desktop">Desktop</button>
      <button class="size-btn" data-size="tablet">Tablet</button>
      <button class="size-btn" data-size="mobile">Mobile</button>
    </div>
    <button class="icon-btn" id="full-btn" style="display:none" title="Open in new tab">↗ Full</button>
  </div>
  <div class="main-content">
    <div id="preview-host" style="display:none">
      <div id="preview-shell">
        <iframe id="preview-frame" title="Component preview"></iframe>
        <div class="resize-handle handle-right" data-resize="right" aria-hidden="true"></div>
        <div class="resize-handle handle-bottom" data-resize="bottom" aria-hidden="true"></div>
        <div class="resize-handle handle-corner" data-resize="corner" aria-hidden="true"></div>
      </div>
    </div>
    <div id="folder-view" style="display:none"></div>
    <div class="empty" id="empty-msg">← Select a component or folder</div>
  </div>
</main>

<script>
'use strict';
const TREE = ${safeTree};

/* ── Theme ────────────────────────────────────────────── */
const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pl-theme', theme);
  document.getElementById('theme-btn').textContent = theme === 'dark' ? '☀ Light' : '🌙 Dark';
  // Push theme to all visible iframes
  document.querySelectorAll('iframe').forEach(f => {
    try { f.contentWindow.postMessage({ type: 'pl-theme', theme }, '*'); } catch {}
  });
};
document.getElementById('theme-btn').addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});
// Init button label
applyTheme(document.documentElement.getAttribute('data-theme') || 'light');

/* ── Helpers ──────────────────────────────────────────── */
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const $ = id => document.getElementById(id);
const VIEWPORT_WIDTHS = { full: null, desktop: 1440, tablet: 768, mobile: 375 };

/* ── View management ─────────────────────────────────── */
let activeId = null;
const nodeMap = new Map(); // id → { node, btnEl }
let activeViewport = 'full';

const setViewportPreset = (size) => {
  activeViewport = VIEWPORT_WIDTHS[size] === undefined ? 'full' : size;
  const shell = $('preview-shell');
  const host = $('preview-host');
  const maxW = Math.max(280, host.clientWidth - 16);
  const maxH = Math.max(220, host.clientHeight - 16);
  const width = VIEWPORT_WIDTHS[activeViewport];
  shell.style.width = width == null ? '100%' : Math.min(width, maxW) + 'px';
  shell.style.height = '100%';
  shell.style.maxWidth = '100%';
  shell.style.maxHeight = '100%';
  shell.dataset.size = activeViewport;
  document.querySelectorAll('[data-size]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.size === activeViewport);
  });
};

const setupViewportResizing = () => {
  const shell = $('preview-shell');
  const host = $('preview-host');
  let drag = null;

  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const maxW = Math.max(280, host.clientWidth - 16);
    const maxH = Math.max(220, host.clientHeight - 16);
    if (drag.mode === 'right' || drag.mode === 'corner') {
      const nextW = Math.min(maxW, Math.max(280, drag.startWidth + dx));
      shell.style.width = nextW + 'px';
    }
    if (drag.mode === 'bottom' || drag.mode === 'corner') {
      const nextH = Math.min(maxH, Math.max(220, drag.startHeight + dy));
      shell.style.height = nextH + 'px';
    }
    activeViewport = 'custom';
    document.querySelectorAll('[data-size]').forEach((btn) => btn.classList.remove('active'));
  };

  const onUp = () => {
    if (!drag) return;
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  $('preview-shell').addEventListener('pointerdown', (e) => {
    const mode = e.target.getAttribute('data-resize');
    if (!mode) return;
    e.preventDefault();
    drag = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: shell.getBoundingClientRect().width,
      startHeight: shell.getBoundingClientRect().height,
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
};

const showEmpty = () => {
  $('preview-host').style.display = 'none';
  $('folder-view').style.display = 'none';
  $('empty-msg').style.display = '';
  $('full-btn').style.display = 'none';
  $('viewport-tools').style.display = 'none';
  $('breadcrumb').textContent = '';
  activeId = null; refreshActive();
};

const showComponent = (id, outputPath, label) => {
  activeId = id;
  $('preview-host').style.display = '';
  $('preview-frame').src = '/' + outputPath;
  $('folder-view').style.display = 'none';
  $('empty-msg').style.display = 'none';
  $('breadcrumb').textContent = label;
  $('full-btn').style.display = '';
  $('viewport-tools').style.display = '';
  setViewportPreset(activeViewport === 'custom' ? 'full' : activeViewport);
  $('full-btn').onclick = () => window.open('/' + outputPath, '_blank');
  history.replaceState({}, '', '?id=' + encodeURIComponent(id));
  refreshActive();
  // Sync theme to new iframe once loaded
  $('preview-frame').onload = () => {
    try { $('preview-frame').contentWindow.postMessage({ type: 'pl-theme', theme: localStorage.getItem('pl-theme') || 'light' }, '*'); } catch {}
  };
};

const flattenComponents = (node) => {
  const out = [];
  if (node.type === 'component') { out.push(node); return out; }
  for (const child of (node.children || [])) out.push(...flattenComponents(child));
  return out;
};

const showFolder = (node) => {
  activeId = node.id;
  $('preview-host').style.display = 'none';
  $('empty-msg').style.display = 'none';
  $('full-btn').style.display = 'none';
  $('viewport-tools').style.display = 'none';
  $('breadcrumb').textContent = node.label;
  history.replaceState({}, '', '?id=' + encodeURIComponent(node.id));

  const comps = flattenComponents(node);
  const fv = $('folder-view');
  fv.style.display = '';
  fv.innerHTML = comps.map(c => {
    const varBtns = (c.variations || []).map(v =>
      '<button class="var-btn" data-act="comp" data-id="' + escHtml(v.id) + '" data-path="' + escHtml(v.outputPath) + '" data-label="' + escHtml(v.label) + '">' + escHtml(v.label) + '</button>'
    ).join('');
    return '<div class="ccard">'
      + '<div class="ccard-hd">' + escHtml(c.label)
      + '<button class="open-btn" data-act="comp" data-id="' + escHtml(c.id) + '" data-path="' + escHtml(c.outputPath) + '" data-label="' + escHtml(c.label) + '">Open</button></div>'
      + (varBtns ? '<div class="ccard-vars">' + varBtns + '</div>' : '')
      + '<iframe src="/' + escHtml(c.outputPath) + '" loading="lazy" title="' + escHtml(c.label) + '"></iframe>'
      + '</div>';
  }).join('') || '<p style="color:var(--text-muted);grid-column:1/-1">No components in this folder.</p>';

  refreshActive();
};

/* ── Tree building ───────────────────────────────────── */
const refreshActive = () => {
  for (const [id, { btnEl }] of nodeMap) btnEl.classList.toggle('active', id === activeId);
};

const buildTree = (nodes, ulEl, depth) => {
  for (const node of nodes) {
    if (node.hidden) continue;
    const li = document.createElement('li');
    li.className = 'tree-item ' + (node.type === 'folder' ? 'tree-folder' : node.type === 'variation' ? 'tree-variation' : 'tree-component');

    const btn = document.createElement('button');
    btn.className = 'tree-btn';
    btn.style.paddingLeft = (.75 + depth * .65) + 'rem';

    const icon = document.createElement('span');
    icon.className = 'icon';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = node.label;
    btn.append(icon, lbl);
    li.appendChild(btn);

    nodeMap.set(node.id, { node, btnEl: btn });

    const hasChildren = (node.type === 'folder' && (node.children || []).length > 0)
      || (node.type === 'component' && (node.variations || []).length > 0);

    if (hasChildren) {
      icon.textContent = '▶';
      const childUl = document.createElement('ul');
      childUl.className = 'tree tree-children';
      li.appendChild(childUl);
      const childNodes = node.type === 'folder' ? (node.children || []) : (node.variations || []);
      buildTree(childNodes, childUl, depth + 1);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = li.classList.toggle('open');
        icon.textContent = open ? '▼' : '▶';
        if (node.type === 'folder') showFolder(node);
        else showComponent(node.id, node.outputPath, node.label);
      });
    } else {
      icon.textContent = node.type === 'variation' ? '◦' : '○';
      btn.addEventListener('click', () => {
        if (node.type === 'folder') showFolder(node);
        else showComponent(node.id, node.outputPath, node.label);
      });
    }

    ulEl.appendChild(li);
  }
};

buildTree(TREE.children || [], $('tree-root'), 0);
setupViewportResizing();
document.querySelectorAll('#viewport-tools [data-size]').forEach((btn) => {
  btn.addEventListener('click', () => setViewportPreset(btn.dataset.size));
});
window.addEventListener('resize', () => {
  if ($('preview-host').style.display === 'none') return;
  if (activeViewport === 'custom') return;
  setViewportPreset(activeViewport);
});

/* ── Folder-view card clicks ─────────────────────────── */
$('folder-view').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'comp') showComponent(btn.dataset.id, btn.dataset.path, btn.dataset.label);
});

/* ── URL restore ─────────────────────────────────────── */
const restoreId = new URLSearchParams(location.search).get('id');
if (restoreId && nodeMap.has(restoreId)) {
  const { node } = nodeMap.get(restoreId);
  if (node.type === 'folder') showFolder(node);
  else showComponent(node.id, node.outputPath, node.label);
} else {
  const first = flattenComponents(TREE)[0];
  if (first) showComponent(first.id, first.outputPath, first.label);
}
</script>
</body>
</html>`;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const discover = () => {
  const globalData = readJson(path.join(srcRoot, "_global.json")) ?? {};
  const tree = discoverDir(componentsRoot, "", globalData);
  if (!tree) {
    console.error("No components found under src/components/");
    process.exit(1);
  }
  return tree;
};

const writeCssJs = async (tree) => {
  const { scss: scssFiles, js: jsFiles } = collectStyleAssets(tree);
  const css = await buildCss(scssFiles);
  writeFile(
    path.join(distRoot, "app.css"),
    css || "/* no component styles */\n",
  );
  const js = buildJs(jsFiles);
  writeFile(
    path.join(distRoot, "app.js"),
    js || "/* no component scripts */\n",
  );
};

const renderAll = async (tree) => {
  const renderables = flattenRenderables(tree);
  const componentHeadExtra = readText(
    path.join(srcRoot, "_component-head.html"),
  );
  for (const item of renderables) {
    const html = await renderItem(item, componentHeadExtra);
    const outPath = path.join(distRoot, ...item.outputPath.split("/"));
    writeFile(outPath, html);
  }
  return renderables;
};

const main = async () => {
  if (buildMode === "full") {
    fs.rmSync(distRoot, { recursive: true, force: true });
    fs.mkdirSync(distRoot, { recursive: true });
    const tree = discover();
    const renderables = await renderAll(tree);
    await writeCssJs(tree);
    copyDir(assetsRoot, path.join(distRoot, "assets"));
    const publicTree = stripPrivate(tree);
    writeFile(
      path.join(distRoot, "tree.json"),
      JSON.stringify(publicTree, null, 2) + "\n",
    );
    const manifest = renderables.map(({ id, label, type, outputPath }) => ({
      id,
      label,
      type,
      outputPath,
    }));
    writeFile(
      path.join(distRoot, "components.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    writeFile(
      path.join(distRoot, "index.html"),
      buildIndexHtml(publicTree, renderables.length),
    );
    console.log(`Rendered ${renderables.length} component(s) into ${distRoot}`);
    return;
  }

  if (buildMode === "styles") {
    fs.mkdirSync(distRoot, { recursive: true });
    const tree = discover();
    await writeCssJs(tree);
    console.log(`Rebuilt app.css/app.js in ${distRoot}`);
    return;
  }

  if (buildMode === "component") {
    fs.mkdirSync(distRoot, { recursive: true });
    const tree = discover();
    const renderables = flattenRenderables(tree);
    const ids = resolveAffectedComponentIds(changedSource, renderables);
    if (ids.length === 0) {
      console.log("No matching component targets found");
      return;
    }
    const idSet = new Set(ids);
    const componentHeadExtra = readText(
      path.join(srcRoot, "_component-head.html"),
    );
    for (const item of renderables) {
      if (!idSet.has(item.id)) continue;
      const html = await renderItem(item, componentHeadExtra);
      const outPath = path.join(distRoot, ...item.outputPath.split("/"));
      writeFile(outPath, html);
    }
    console.log(`Re-rendered ${ids.length} component page(s)`);
    return;
  }

  console.error(`Unknown build mode "${buildMode}"`);
  process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
