import fs from "node:fs";
import path from "node:path";
import browserslist from "browserslist";
import browserslistToEsbuild from "browserslist-to-esbuild";

const DEFAULT_CONFIG = {
  title: "Pattern Lab",
  ui: {
    showThemeToggle: true,
    showViewportControls: true,
    enableResizeHandles: true,
  },
  css: {
    enabled: true,
    includeComponentFiles: true,
    entryFile: "src/scss/style.scss",
    outputFile: "app.css",
    baseFiles: [],
    loadPaths: [],
  },
  js: {
    compiler: "esbuild",
    enabled: true,
    bundle: true,
    includeComponentFiles: true,
    entryFile: null,
    outputFile: "app.js",
    target: ["es2020"],
    targetQuery: null,
    baseFiles: [],
  },
};

const isObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

const mergeDeep = (...objs) => {
  const result = {};
  for (const obj of objs) {
    if (!isObject(obj)) continue;
    for (const [key, value] of Object.entries(obj)) {
      if (isObject(value) && isObject(result[key])) {
        result[key] = mergeDeep(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
};

const readJsonSafe = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const toPosix = (value) => value.split(path.sep).join("/");

const collectFiles = (targetPath, extensions) => {
  const output = [];
  const walk = (absPath) => {
    if (!fs.existsSync(absPath)) return;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      for (const entry of fs
        .readdirSync(absPath, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        walk(path.join(absPath, entry.name));
      }
      return;
    }
    if (!extensions.has(path.extname(absPath))) return;
    output.push(absPath);
  };
  walk(targetPath);
  return output;
};

const normalizePathList = (repoRoot, items) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .map((item) => path.resolve(repoRoot, item));
};

const normalizeOutputFile = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized || fallback;
};

const resolveOptionalFile = (repoRoot, filePath) => {
  if (typeof filePath !== "string" || filePath.trim() === "") return null;
  const resolved = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(resolved)) return null;
  if (!fs.statSync(resolved).isFile()) return null;
  return resolved;
};

const normalizeTargetArray = (targets) => {
  if (!Array.isArray(targets)) return [];
  return targets
    .filter((target) => typeof target === "string" && target.trim() !== "")
    .map((target) => target.trim());
};

const normalizeJsCompiler = (value) => {
  if (typeof value !== "string" || value.trim() === "") {
    return { compiler: "esbuild", warning: null };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "esbuild") {
    return { compiler: "esbuild", warning: null };
  }

  return {
    compiler: "esbuild",
    warning: `Unsupported js.compiler \"${value}\". Falling back to \"esbuild\".`,
  };
};

const resolveJsTargets = (jsConfig) => {
  const warnings = [];
  const explicitTargets = normalizeTargetArray(jsConfig?.target);
  if (explicitTargets.length > 0) {
    return { target: explicitTargets, warnings };
  }

  const queryCandidates = [];
  if (
    typeof jsConfig?.targetQuery === "string" &&
    jsConfig.targetQuery.trim()
  ) {
    queryCandidates.push({ value: jsConfig.targetQuery, field: "targetQuery" });
  }
  if (typeof jsConfig?.target === "string" && jsConfig.target.trim()) {
    queryCandidates.push({ value: jsConfig.target, field: "target" });
  }

  for (const queryCandidate of queryCandidates) {
    try {
      const resolvedTargets = browserslistToEsbuild(
        browserslist(queryCandidate.value.trim()),
      );
      const normalizedTargets = normalizeTargetArray(resolvedTargets);
      if (normalizedTargets.length > 0) {
        return { target: normalizedTargets, warnings };
      }
    } catch (error) {
      warnings.push(
        `Invalid js.${queryCandidate.field} browserslist query \"${queryCandidate.value}\".`,
      );
    }
  }

  return { target: ["es2020"], warnings };
};

export const loadPatternlabConfig = (repoRoot) => {
  const configPath = path.join(repoRoot, "patternlab.config.json");
  const loaded = readJsonSafe(configPath) ?? {};
  const pkg = readJsonSafe(path.join(repoRoot, "package.json")) ?? {};
  const config = mergeDeep(DEFAULT_CONFIG, loaded);
  const configWarnings = [];

  const cssBaseCandidates = normalizePathList(repoRoot, config.css?.baseFiles);
  const jsBaseCandidates = normalizePathList(repoRoot, config.js?.baseFiles);

  const cssBaseFiles = cssBaseCandidates.flatMap((candidate) =>
    collectFiles(candidate, new Set([".scss", ".css"])),
  );
  const jsBaseFiles = jsBaseCandidates.flatMap((candidate) =>
    collectFiles(candidate, new Set([".js", ".mjs", ".cjs"])),
  );

  const cssLoadPaths = normalizePathList(
    repoRoot,
    config.css?.loadPaths,
  ).filter(
    (candidate) =>
      fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
  );
  const { compiler: jsCompiler, warning: jsCompilerWarning } =
    normalizeJsCompiler(config.js?.compiler);
  if (jsCompilerWarning) configWarnings.push(jsCompilerWarning);
  const { target: jsTargets, warnings: jsTargetWarnings } = resolveJsTargets(
    config.js,
  );
  configWarnings.push(...jsTargetWarnings);

  return {
    ...config,
    packageVersion: typeof pkg.version === "string" ? pkg.version : "",
    css: {
      ...config.css,
      entryFile: resolveOptionalFile(repoRoot, config.css?.entryFile),
      outputFile: normalizeOutputFile(config.css?.outputFile, "app.css"),
      baseFiles: cssBaseFiles,
      loadPaths: cssLoadPaths,
    },
    js: {
      ...config.js,
      compiler: jsCompiler,
      bundle: config.js?.bundle !== false,
      entryFile: resolveOptionalFile(repoRoot, config.js?.entryFile),
      outputFile: normalizeOutputFile(config.js?.outputFile, "app.js"),
      target: jsTargets,
      baseFiles: jsBaseFiles,
    },
    _meta: {
      titleWithVersion:
        typeof pkg.version === "string" && pkg.version
          ? `${config.title} v${pkg.version}`
          : config.title,
      cssBaseFilesRelative: cssBaseFiles.map((filePath) =>
        toPosix(path.relative(repoRoot, filePath)),
      ),
      jsBaseFilesRelative: jsBaseFiles.map((filePath) =>
        toPosix(path.relative(repoRoot, filePath)),
      ),
      configWarnings,
    },
  };
};
