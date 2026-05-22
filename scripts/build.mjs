import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPatternlabConfig } from "./lib/config.mjs";
import { loadRootGlobalData, mergeDeep } from "./lib/global-data.mjs";

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const componentsRoot = path.join(srcRoot, "components");
const assetsRoot = path.join(srcRoot, "assets");
const distRoot = path.join(repoRoot, "dist");
const phpRenderer = path.join(repoRoot, "php", "render.php");
const templatesRoot = path.join(repoRoot, "scripts", "templates");
const patternlabConfig = loadPatternlabConfig(repoRoot);

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

const toLabel = (stem) =>
  stem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const escHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

const buildCss = async (styleFiles, loadPaths = []) => {
  if (styleFiles.length === 0) return "";
  const combined = styleFiles
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

    const compiled = styleFiles.map((filePath) => {
      const ext = path.extname(filePath);
      if (ext === ".css") {
        return `/* ${toPosix(path.relative(srcRoot, filePath))} */\n${fs.readFileSync(filePath, "utf8")}`;
      }
      const result = sass.compile(filePath, {
        loadPaths: [componentsRoot, srcRoot, ...loadPaths],
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

const readTemplate = (name) =>
  fs.readFileSync(path.join(templatesRoot, name), "utf8");

const buildIndexHtml = (publicTree, totalCount) => {
  const safeTree = JSON.stringify(publicTree).replace(/<\//g, "<\\/");
  const safeUiConfig = JSON.stringify(patternlabConfig.ui).replace(/<\//g, "<\\/");
  const indexCss = readTemplate("index.css");
  const indexJs = readTemplate("index.js")
    .replace("__TREE_JSON__", safeTree)
    .replace("__UI_CONFIG__", safeUiConfig);
  return readTemplate("index.shell.html")
    .replace(/__PAGE_TITLE__/g, escHtml(patternlabConfig.title))
    .replace(/__HEADER_TITLE__/g, escHtml(patternlabConfig.title))
    .replace(
      /__HEADER_VERSION__/g,
      escHtml(patternlabConfig.packageVersion ? `v${patternlabConfig.packageVersion}` : ""),
    )
    .replace(/__TOTAL_COUNT__/g, String(totalCount))
    .replace(/__TOTAL_SUFFIX__/g, totalCount !== 1 ? "s" : "")
    .replace("__INDEX_CSS__", indexCss)
    .replace("__INDEX_JS__", indexJs);
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const discover = () => {
  const globalData = loadRootGlobalData(srcRoot);
  const tree = discoverDir(componentsRoot, "", globalData);
  if (!tree) {
    console.error("No components found under src/components/");
    process.exit(1);
  }
  return tree;
};

const writeCssJs = async (tree) => {
  const { scss: componentScssFiles, js: componentJsFiles } = collectStyleAssets(tree);
  const cssFiles = [
    ...(patternlabConfig.css.includeComponentFiles ? componentScssFiles : []),
    ...patternlabConfig.css.baseFiles,
  ];
  const jsFiles = [
    ...(patternlabConfig.js.includeComponentFiles ? componentJsFiles : []),
    ...patternlabConfig.js.baseFiles,
  ];
  const css = patternlabConfig.css.enabled
    ? await buildCss(cssFiles, patternlabConfig.css.loadPaths)
    : "";
  writeFile(
    path.join(distRoot, "app.css"),
    css || "/* no component styles */\n",
  );
  const js = patternlabConfig.js.enabled ? buildJs(jsFiles) : "";
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
