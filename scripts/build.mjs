import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeContext } from "./lib/runtime-context.mjs";
import { loadRootGlobalData, mergeDeep } from "./lib/global-data.mjs";
import { createHookRunner, loadPlugins } from "./lib/plugins.mjs";
import { readJsonSafe, readTextSafe, writeFileSafe } from "./lib/core/fs.mjs";
import {
  normalizeCardDisplay as normalizeCardDisplayMeta,
  readFolderMeta as readFolderMetaShared,
  readMeta as readMetaShared,
  toLabel as toLabelShared,
} from "./lib/core/meta.mjs";
import { pathToFileURL } from "url";

// ─── Paths ────────────────────────────────────────────────────────────────────

const runtimeContext = createRuntimeContext({ scriptUrl: import.meta.url });
const { argv, repoRoot, coreRoot, patternlabConfig, paths } = runtimeContext;
const phpRenderer = path.join(coreRoot, "php", "render.php");
const getArgValue = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
};
const srcRoot = paths.srcRoot;
const componentsRoot = paths.componentsRoot;
const assetsRoot = paths.assetsRoot;
const distRoot = paths.distRoot;
const templatesRoot = paths.templatesRoot;
const cssOutputFile = patternlabConfig.css.outputFile;
const jsOutputFile = patternlabConfig.js.outputFile;
const componentsOutputDir = patternlabConfig.output.componentsDir;
const treeOutputFile = patternlabConfig.output.treeFile;
const manifestOutputFile = patternlabConfig.output.manifestFile;
const indexOutputFile = patternlabConfig.output.indexFile;
for (const warning of patternlabConfig._meta?.configWarnings ?? []) {
  console.warn(`[patternlab.config] ${warning}`);
}
const plugins = await loadPlugins(repoRoot, patternlabConfig.plugins);
const hooks = createHookRunner(plugins);
const buildMode = getArgValue("--mode") ?? "full"; // full | styles | component
const changedSource = getArgValue("--source");
const requestedConcurrency = Number(
  getArgValue("--concurrency") ??
    process.env.PL_RENDER_CONCURRENCY ??
    patternlabConfig.build?.renderConcurrency ??
    4,
);
const renderConcurrency =
  Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.floor(requestedConcurrency)
    : 4;

// ─── Supported template engines ───────────────────────────────────────────────

const TEMPLATE_EXTS = new Map(
  Object.entries(patternlabConfig.templating?.engines ?? {}),
);

// ─── Utilities ────────────────────────────────────────────────────────────────

const toPosix = (v) => v.split(path.sep).join("/");
const toPublicAssetPath = (value) =>
  `/${toPosix(String(value).replace(/^\/+/, ""))}`;

const writeFile = writeFileSafe;

const getMtimeMs = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
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

const readMeta = readMetaShared;
const readFolderMeta = readFolderMetaShared;
const readJson = readJsonSafe;
const readText = readTextSafe;
const toLabel = toLabelShared;
const escHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ─── Rendering engines ────────────────────────────────────────────────────────

// Lazy module cache
const engines = {};

const execFileUtf8 = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

const renderTemplate = async (templatePath, engine, context) => {
  const template = fs.readFileSync(templatePath, "utf8");

  if (engine === "twig") {
    const tmpCtx = path.join(
      distRoot,
      `_ctx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
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
    if (patternlabConfig.templating?.twig?.alterFile) {
      args.push("--alter-twig", patternlabConfig.templating.twig.alterFile);
    }
    try {
      return await execFileUtf8("php", args);
    } catch (err) {
      const stderr = err?.stderr ? String(err.stderr).trim() : "";
      const stdout = err?.stdout ? String(err.stdout).trim() : "";
      const details = [stderr, stdout].filter(Boolean).join("\n");
      const relTemplatePath = toPosix(path.relative(repoRoot, templatePath));
      throw new Error(
        `Twig render failed for ${relTemplatePath}${details ? `\n${details}` : ""}`,
      );
    } finally {
      fs.rmSync(tmpCtx, { force: true });
    }
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
  <script>(function(){var t=localStorage.getItem('pl-mode');if(t==='dark'||(t==null&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-mode','dark');})()</script>
  <script>(function(){var t=localStorage.getItem('pl-theme');if(t)document.documentElement.setAttribute('data-theme',t);})()</script>
  <link rel="stylesheet" href="${toPublicAssetPath(cssOutputFile)}">${extra}  <script src="${toPublicAssetPath(jsOutputFile)}" defer></script>`;
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
  if (e.data && e.data.type === 'pl-mode') {
    document.documentElement.setAttribute('data-mode', e.data.mode);
    localStorage.setItem('pl-mode', e.data.mode);
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
const normalizeCardDisplay = normalizeCardDisplayMeta;

const discoverDir = (
  dir,
  relPath,
  parentGlobal,
  parentCardDisplay = "normal",
  inheritedGlobalJsonPaths = [],
) => {
  if (!fs.existsSync(dir)) return null;

  const folderMeta = readFolderMeta(dir);
  const folderCardDisplay = normalizeCardDisplay(
    folderMeta.card_display ??
      folderMeta.cardDisplay ??
      folderMeta["card-display"],
  );
  const effectiveFolderCardDisplay = folderCardDisplay ?? parentCardDisplay;
  const localGlobalJsonPath = path.join(dir, "_global.json");
  const hasLocalGlobalJson = fs.existsSync(localGlobalJsonPath);
  const folderGlobal = mergeDeep(
    parentGlobal,
    readJson(localGlobalJsonPath) ?? {},
  );
  const folderGlobalJsonPaths = hasLocalGlobalJson
    ? [...inheritedGlobalJsonPaths, localGlobalJsonPath]
    : inheritedGlobalJsonPaths;

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
    const outBase = toPosix(path.join(componentsOutputDir, relPath || "", stem));
    const componentCardDisplay =
      normalizeCardDisplay(
        base.meta.card_display ??
          base.meta.cardDisplay ??
          base.meta["card-display"],
      ) ?? effectiveFolderCardDisplay;

    const varNodes = [];
    for (const [varName, varData] of base.variations) {
      const varId = `${compId}~${varName}`;
      const varOut = `${outBase}~${varName}.html`;
      varNodes.push({
        type: "variation",
        id: varId,
        label: toLabel(varName),
        cardDisplay: componentCardDisplay,
        outputPath: varOut,
        _render: {
          templatePath: varData.templatePath,
          engine: varData.engine,
          baseJsonPath: base.jsonPath,
          varJsonPath: varData.jsonPath,
          globalData: folderGlobal,
          globalJsonPaths: folderGlobalJsonPaths,
        },
      });
    }

    componentNodes.push({
      type: "component",
      id: compId,
      label: base.meta.title ?? toLabel(stem),
      order: base.meta.order ?? 999,
      hidden: false,
      cardDisplay: componentCardDisplay,
      outputPath: `${outBase}.html`,
      variations: varNodes,
      _render: {
        templatePath: base.templatePath,
        engine: base.engine,
        baseJsonPath: base.jsonPath,
        varJsonPath: null,
        globalData: folderGlobal,
        globalJsonPaths: folderGlobalJsonPaths,
      },
    });
  }

  // Build sub-folder nodes
  const folderNodes = [];
  for (const { name, fullPath } of subDirs) {
    const childRel = relPath ? `${relPath}/${name}` : name;
    const child = discoverDir(
      fullPath,
      childRel,
      folderGlobal,
      effectiveFolderCardDisplay,
      folderGlobalJsonPaths,
    );
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
    cardDisplay: effectiveFolderCardDisplay,
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

const collectJsonFiles = (rootDir, out = []) => {
  if (!fs.existsSync(rootDir)) return out;
  let stat;
  try {
    stat = fs.statSync(rootDir);
  } catch {
    return out;
  }
  if (!stat.isDirectory()) return out;

  for (const entry of fs
    .readdirSync(rootDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(fullPath, out);
      continue;
    }
    if (path.extname(entry.name) === ".json") out.push(fullPath);
  }

  return out;
};

const collectRootGlobalDependencyFiles = () => {
  const files = [];
  const legacyGlobalPath = path.join(srcRoot, "_global.json");
  if (fs.existsSync(legacyGlobalPath)) files.push(legacyGlobalPath);
  const dataDir = path.join(srcRoot, "data");
  files.push(...collectJsonFiles(dataDir));
  return files;
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

const buildCss = async ({
  entryFile = null,
  styleFiles = [],
  loadPaths = [],
} = {}) => {
  if (!entryFile && styleFiles.length === 0) return "";

  const collectScssFiles = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectScssFiles(fullPath, out);
      } else if (entry.isFile() && path.extname(entry.name) === ".scss") {
        out.push(fullPath);
      }
    }
    return out;
  };

  const globToRegExp = (globPattern) => {
    const escaped = globPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "__DOUBLE_STAR__")
      .replace(/\*/g, "[^/]*")
      .replace(/__DOUBLE_STAR__/g, ".*");
    return new RegExp(`^${escaped}$`);
  };

  const sassModulePath = (scssRelPath) => {
    const posixRel = toPosix(scssRelPath);
    const withoutExt = posixRel.replace(/\.scss$/, "");
    return withoutExt
      .split("/")
      .map((segment) => (segment.startsWith("_") ? segment.slice(1) : segment))
      .join("/");
  };

  const expandSassModuleGlobs = (source, baseDir) =>
    source.replace(
      /^([ \t]*)@(use|forward)\s+["']([^"']*\*[^"']*)["']([^;]*);[ \t]*$/gm,
      (full, indent, kind, importPath, tail) => {
        const matcher = globToRegExp(importPath);
        const absolutePattern = path.resolve(baseDir, importPath);
        const wildcardIndex = absolutePattern.search(/[*]/);
        const patternPrefix =
          wildcardIndex === -1
            ? absolutePattern
            : absolutePattern.slice(0, wildcardIndex);
        const searchRoot = path.dirname(patternPrefix);

        const resolved = collectScssFiles(searchRoot)
          .map((filePath) => toPosix(path.relative(baseDir, filePath)))
          .filter((relPath) => matcher.test(relPath))
          .sort((a, b) => a.localeCompare(b));

        if (resolved.length === 0) {
          return full;
        }

        return resolved
          .map(
            (relPath) =>
              `${indent}@${kind} "${sassModulePath(relPath)}"${tail};`,
          )
          .join("\n");
      },
    );

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

    if (entryFile) {
      const expandedEntry = expandSassModuleGlobs(
        fs.readFileSync(entryFile, "utf8"),
        path.dirname(entryFile),
      );

      const result = sass.compileString(expandedEntry, {
        url: pathToFileURL(entryFile),
        loadPaths: [componentsRoot, srcRoot, ...loadPaths],
        style: "expanded",
        charset: false,
        importers: [
          {
            findFileUrl(url) {
              if (!url.startsWith("@")) {
                return null;
              }
              return pathToFileURL(
                path.resolve(
                  fileURLToPath(import.meta.url),
                  `${srcRoot}/scss/generic/_${url.slice(1)}.scss`,
                ),
              );
            },
          },
        ],
      });

      const cssExtras = styleFiles
        .filter((filePath) => path.extname(filePath) === ".css")
        .map(
          (filePath) =>
            `/* ${toPosix(path.relative(srcRoot, filePath))} */\n${fs.readFileSync(filePath, "utf8")}`,
        );

      return [result.css, ...cssExtras].filter(Boolean).join("\n\n");
    }

    const compiled = styleFiles.map((filePath) => {
      const ext = path.extname(filePath);
      if (ext === ".css") {
        return `/* ${toPosix(path.relative(srcRoot, filePath))} */\n${fs.readFileSync(filePath, "utf8")}`;
      }
      const result = sass.compile(filePath, {
        loadPaths: [componentsRoot, srcRoot, ...loadPaths],
        style: "expanded",
        charset: false,
        importers: [
          {
            findFileUrl(url) {
              if (!url.startsWith("@")) {
                return null;
              }
              return pathToFileURL(
                path.resolve(
                  fileURLToPath(import.meta.url),
                  `${srcRoot}/scss/generic/_${url.slice(1)}.scss`,
                ),
              );
            },
          },
        ],
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

const buildJs = async (
  jsFiles,
  { bundle = true, target = ["es2020"], compiler = "esbuild" } = {},
) => {
  if (jsFiles.length === 0) return "";

  const combined = jsFiles
    .map(
      (f) =>
        `/* ${toPosix(path.relative(srcRoot, f))} */\n${fs.readFileSync(f, "utf8")}`,
    )
    .join("\n\n");

  if (!bundle) {
    return combined;
  }

  if (compiler !== "esbuild") {
    throw new Error(
      `Unsupported js compiler \"${compiler}\". Supported values: esbuild`,
    );
  }

  const bundleEntry = `${jsFiles
    .map((filePath) => {
      const rel = toPosix(path.relative(repoRoot, filePath));
      const specifier = rel.startsWith(".") ? rel : `./${rel}`;
      return `import ${JSON.stringify(specifier)};`;
    })
    .join("\n")}\n`;

  try {
    const esbuildModule = await import("esbuild");
    const esbuild =
      typeof esbuildModule.build === "function"
        ? esbuildModule
        : esbuildModule.default;
    if (!esbuild || typeof esbuild.build !== "function") {
      throw new Error("esbuild API not found");
    }

    const result = await esbuild.build({
      stdin: {
        contents: bundleEntry,
        resolveDir: repoRoot,
        sourcefile: "_app.entry.mjs",
        loader: "js",
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      target,
      write: false,
      logLevel: "silent",
      legalComments: "none",
    });

    const jsOutput =
      result.outputFiles && result.outputFiles.length > 0
        ? result.outputFiles[0].text
        : "";
    if (!jsOutput) throw new Error("esbuild produced no output");
    return jsOutput;
  } catch (err) {
    console.warn(
      `JS bundle failed; using raw concatenated scripts. ${err?.message ?? ""}`.trim(),
    );
    return combined;
  } finally {
    // no-op
  }
};

// ─── Strip internal _* fields before serialising ──────────────────────────────

const stripPrivate = (node) => {
  const { _render, _scss, _js, ...rest } = node;
  if (rest.children) rest.children = rest.children.map(stripPrivate);
  if (rest.variations) rest.variations = rest.variations.map(stripPrivate);
  return rest;
};

// ─── Render a single component or variation ────────────────────────────────────

const renderItem = async (item, componentHeadExtra) => {
  const renderPayload = await hooks.run("beforeRenderItem", {
    item,
    componentHeadExtra,
  });
  const renderItemInput = renderPayload?.item ?? item;
  const headInput = renderPayload?.componentHeadExtra ?? componentHeadExtra;
  const { templatePath, engine, baseJsonPath, varJsonPath, globalData } =
    renderItemInput._render;
  const baseData = baseJsonPath ? (readJson(baseJsonPath) ?? {}) : {};
  const varData = varJsonPath ? (readJson(varJsonPath) ?? {}) : {};
  const context = mergeDeep(globalData, baseData, varData);
  const body = await renderTemplate(templatePath, engine, context);
  const wrapped = wrapComponent(body, headInput);
  const afterPayload = await hooks.run("afterRenderItem", {
    item: renderItemInput,
    html: wrapped,
  });
  return afterPayload?.html ?? wrapped;
};

// ─── UI HTML ─────────────────────────────────────────────────────────────────

const readTemplate = (name) =>
  fs.readFileSync(path.join(templatesRoot, name), "utf8");

const buildIndexHtml = (publicTree, totalCount) => {
  const safeTree = JSON.stringify(publicTree).replace(/<\//g, "<\\/");
  const safeUiConfig = JSON.stringify(patternlabConfig.ui).replace(
    /<\//g,
    "<\\/",
  );
  const indexCss = readTemplate("index.css");
  const indexJs = readTemplate("index.js")
    .replace("__TREE_JSON__", safeTree)
    .replace("__UI_CONFIG__", safeUiConfig);
  return readTemplate("index.shell.html")
    .replace(/__PAGE_TITLE__/g, escHtml(patternlabConfig.title))
    .replace(/__HEADER_TITLE__/g, escHtml(patternlabConfig.title))
    .replace(
      /__HEADER_VERSION__/g,
      escHtml(
        patternlabConfig.packageVersion
          ? `v${patternlabConfig.packageVersion}`
          : "",
      ),
    )
    .replace(/__TOTAL_COUNT__/g, String(totalCount))
    .replace(/__TOTAL_SUFFIX__/g, totalCount !== 1 ? "s" : "")
    .replace("__INDEX_CSS__", indexCss)
    .replace("__INDEX_JS__", indexJs);
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const discover = async () => {
  await hooks.run("beforeDiscover", { componentsRoot, patternlabConfig });
  const globalData = loadRootGlobalData({
    srcRoot,
    dataRoot: patternlabConfig.paths.dataRoot,
  });
  const tree = discoverDir(componentsRoot, "", globalData, "normal");
  if (!tree) {
    console.error(
      `No components found under ${toPosix(path.relative(repoRoot, componentsRoot))}/`,
    );
    process.exit(1);
  }
  const payload = await hooks.run("afterDiscover", { tree, patternlabConfig });
  return payload?.tree ?? tree;
};

const writeCssJs = async (tree) => {
  const { scss: componentScssFiles, js: componentJsFiles } =
    collectStyleAssets(tree);
  const mainStyleEntry = patternlabConfig.css.entryFile;
  const hasMainStyleEntry = Boolean(mainStyleEntry);
  const cssFiles = [
    ...(patternlabConfig.css.includeComponentFiles ? componentScssFiles : []),
    ...patternlabConfig.css.baseFiles,
  ];
  const cssFilesWithoutEntry = hasMainStyleEntry
    ? cssFiles.filter(
        (filePath) => path.resolve(filePath) !== path.resolve(mainStyleEntry),
      )
    : cssFiles;
  const jsFiles = [
    ...(patternlabConfig.js.entryFile ? [patternlabConfig.js.entryFile] : []),
    ...(patternlabConfig.js.includeComponentFiles ? componentJsFiles : []),
    ...patternlabConfig.js.baseFiles,
  ];
  const dedupedJsFiles = [
    ...new Set(jsFiles.map((filePath) => path.resolve(filePath))),
  ];
  const css = patternlabConfig.css.enabled
    ? await buildCss({
        entryFile: hasMainStyleEntry ? mainStyleEntry : null,
        styleFiles: hasMainStyleEntry ? cssFilesWithoutEntry : cssFiles,
        loadPaths: patternlabConfig.css.loadPaths,
      })
    : "";
  writeFile(
    path.join(distRoot, ...cssOutputFile.split("/")),
    css || "/* no component styles */\n",
  );
  const js = patternlabConfig.js.enabled
    ? await buildJs(dedupedJsFiles, {
        compiler: patternlabConfig.js.compiler,
        bundle: patternlabConfig.js.bundle !== false,
        target: patternlabConfig.js.target,
      })
    : "";
  writeFile(
    path.join(distRoot, ...jsOutputFile.split("/")),
    js || "/* no component scripts */\n",
  );
};

const renderAll = async (tree) => {
  const renderables = flattenRenderables(tree);
  const componentHeadExtra = readText(patternlabConfig.paths.componentHeadPath);
  const total = renderables.length;
  const workerCount = Math.max(1, Math.min(renderConcurrency, total));
  let nextIndex = 0;
  let rendered = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;

      const item = renderables[index];
      const html = await renderItem(item, componentHeadExtra);
      const outPath = path.join(distRoot, ...item.outputPath.split("/"));
      writeFile(outPath, html);
      rendered += 1;
      console.log(
        `[${rendered}/${total}] Rendered ${item.id} → ${toPosix(path.relative(distRoot, outPath))}`,
      );
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return renderables;
};

const writeSharedArtifacts = async (tree, renderables) => {
  await hooks.run("beforeWriteArtifacts", { tree, renderables });
  await writeCssJs(tree);
  copyDir(assetsRoot, path.join(distRoot, "assets"));

  const publicTree = stripPrivate(tree);
  writeFile(
    path.join(distRoot, ...treeOutputFile.split("/")),
    JSON.stringify(publicTree, null, 2) + "\n",
  );

  const manifest = renderables.map(({ id, label, type, outputPath }) => ({
    id,
    label,
    type,
    outputPath,
  }));
  writeFile(
    path.join(distRoot, ...manifestOutputFile.split("/")),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  writeFile(
    path.join(distRoot, ...indexOutputFile.split("/")),
    buildIndexHtml(publicTree, renderables.length),
  );
  await hooks.run("afterWriteArtifacts", { tree, renderables });
};

const main = async () => {
  await hooks.run("beforeBuild", {
    buildMode,
    changedSource,
    patternlabConfig,
  });
  console.log(
    `Building pattern library (mode: ${buildMode}, render concurrency: ${renderConcurrency})...`,
  );
  if (buildMode === "full") {
    fs.rmSync(distRoot, { recursive: true, force: true });
    fs.mkdirSync(distRoot, { recursive: true });
    console.log("Discovering components...");
    const tree = await discover();
    console.log("Rendering components...");
    const renderables = await renderAll(tree);
    console.log("Building shared assets and index...");
    await writeSharedArtifacts(tree, renderables);
    console.log(`Rendered ${renderables.length} component(s) into ${distRoot}`);
    await hooks.run("afterBuild", {
      buildMode,
      changedSource,
      patternlabConfig,
      result: { renderablesCount: renderables.length },
    });
    return;
  }

  if (buildMode === "styles") {
    fs.mkdirSync(distRoot, { recursive: true });
    const tree = await discover();
    await writeCssJs(tree);
    console.log(`Rebuilt ${cssOutputFile} and ${jsOutputFile} in ${distRoot}`);
    await hooks.run("afterBuild", {
      buildMode,
      changedSource,
      patternlabConfig,
      result: {},
    });
    return;
  }

  if (buildMode === "modified-components") {
    fs.mkdirSync(distRoot, { recursive: true });
    const tree = await discover();
    const renderables = flattenRenderables(tree);
    const componentHeadPath = patternlabConfig.paths.componentHeadPath;
    const componentHeadExtra = readText(componentHeadPath);
    const rootGlobalDependencyFiles = collectRootGlobalDependencyFiles();
    let renderedCount = 0;

    for (const item of renderables) {
      const outPath = path.join(distRoot, ...item.outputPath.split("/"));
      const outputMtime = getMtimeMs(outPath);
      const dependencyFiles = [
        item._render.templatePath,
        item._render.baseJsonPath,
        item._render.varJsonPath,
        ...(item._render.globalJsonPaths ?? []),
        ...rootGlobalDependencyFiles,
        componentHeadPath,
      ].filter(Boolean);
      const newestDependencyMtime = Math.max(
        ...dependencyFiles.map((filePath) => getMtimeMs(filePath)),
        0,
      );

      if (outputMtime > 0 && newestDependencyMtime <= outputMtime) continue;

      const html = await renderItem(item, componentHeadExtra);
      writeFile(outPath, html);
      renderedCount += 1;
      console.log(
        `[${renderedCount}] Re-rendered ${item.id} → ${toPosix(path.relative(distRoot, outPath))}`,
      );
    }

    if (renderedCount === 0) {
      console.log("No component updates required since last build");
    } else {
      console.log(
        `Re-rendered ${renderedCount} component page(s) based on source changes`,
      );
    }

    console.log("Building shared assets and index...");
    await writeSharedArtifacts(tree, renderables);
    await hooks.run("afterBuild", {
      buildMode,
      changedSource,
      patternlabConfig,
      result: { renderablesCount: renderables.length },
    });
    return;
  }

  if (buildMode === "component") {
    fs.mkdirSync(distRoot, { recursive: true });
    const tree = await discover();
    const renderables = flattenRenderables(tree);
    const ids = resolveAffectedComponentIds(changedSource, renderables);
    if (ids.length === 0) {
      console.log("No matching component targets found");
      return;
    }
    const idSet = new Set(ids);
    const componentHeadExtra = readText(patternlabConfig.paths.componentHeadPath);
    for (const item of renderables) {
      if (!idSet.has(item.id)) continue;
      const html = await renderItem(item, componentHeadExtra);
      const outPath = path.join(distRoot, ...item.outputPath.split("/"));
      writeFile(outPath, html);
    }
    console.log(`Re-rendered ${ids.length} component page(s)`);
    await hooks.run("afterBuild", {
      buildMode,
      changedSource,
      patternlabConfig,
      result: { renderablesCount: ids.length },
    });
    return;
  }

  console.error(`Unknown build mode "${buildMode}"`);
  process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
