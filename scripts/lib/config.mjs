import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CONFIG = {
  title: 'Pattern Lab',
  ui: {
    showThemeToggle: true,
    showViewportControls: true,
    enableResizeHandles: true,
  },
  css: {
    enabled: true,
    includeComponentFiles: true,
    baseFiles: [],
    loadPaths: [],
  },
  js: {
    enabled: true,
    includeComponentFiles: true,
    baseFiles: [],
  },
};

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

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
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const toPosix = (value) => value.split(path.sep).join('/');

const collectFiles = (targetPath, extensions) => {
  const output = [];
  const walk = (absPath) => {
    if (!fs.existsSync(absPath)) return;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => path.resolve(repoRoot, item));
};

export const loadPatternlabConfig = (repoRoot) => {
  const configPath = path.join(repoRoot, 'patternlab.config.json');
  const loaded = readJsonSafe(configPath) ?? {};
  const pkg = readJsonSafe(path.join(repoRoot, 'package.json')) ?? {};
  const config = mergeDeep(DEFAULT_CONFIG, loaded);

  const cssBaseCandidates = normalizePathList(repoRoot, config.css?.baseFiles);
  const jsBaseCandidates = normalizePathList(repoRoot, config.js?.baseFiles);

  const cssBaseFiles = cssBaseCandidates.flatMap((candidate) => collectFiles(candidate, new Set(['.scss', '.css'])));
  const jsBaseFiles = jsBaseCandidates.flatMap((candidate) => collectFiles(candidate, new Set(['.js', '.mjs', '.cjs'])));

  const cssLoadPaths = normalizePathList(repoRoot, config.css?.loadPaths)
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());

  return {
    ...config,
    packageVersion: typeof pkg.version === 'string' ? pkg.version : '',
    css: {
      ...config.css,
      baseFiles: cssBaseFiles,
      loadPaths: cssLoadPaths,
    },
    js: {
      ...config.js,
      baseFiles: jsBaseFiles,
    },
    _meta: {
      titleWithVersion: typeof pkg.version === 'string' && pkg.version ? `${config.title} v${pkg.version}` : config.title,
      cssBaseFilesRelative: cssBaseFiles.map((filePath) => toPosix(path.relative(repoRoot, filePath))),
      jsBaseFilesRelative: jsBaseFiles.map((filePath) => toPosix(path.relative(repoRoot, filePath))),
    },
  };
};
