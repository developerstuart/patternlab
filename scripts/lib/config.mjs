import fs from 'node:fs';
import path from 'node:path';
import browserslist from 'browserslist';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import { collectFilesByExtension, readJsonSafe } from './core/fs.mjs';
import { mergeDeep } from './core/object.mjs';
import {
  normalizeOutputFile,
  normalizePathList,
  resolveOptionalFile,
  toPosix,
} from './core/path.mjs';

const DEFAULT_CONFIG = {
  title: 'Pattern Lab',
  compatibility: {
    mode: 'v1',
    preserveLegacyPaths: true,
  },
  paths: {
    srcRoot: 'src',
    componentsRoot: 'components',
    dataRoot: 'data',
    assetsRoot: 'assets',
    distRoot: 'dist',
    componentHeadFile: '_component-head.html',
    templatesRoot: 'scripts/templates',
  },
  ui: {
    showModeToggle: true,
    showThemeToggle: true,
    themes: ['default', 'alternative', 'grey'],
    showViewportControls: true,
    enableResizeHandles: true,
    preview: {
      viewportPresets: {
        full: null,
        desktop: 1440,
        tablet: 768,
        mobile: 375,
      },
      normalHeight: 220,
      fullWidth: 1440,
      fullHeight: 900,
      fullMinHeight: 140,
      fullMaxHeight: 280,
    },
  },
  templating: {
    engines: {
      '.twig': 'twig',
      '.mustache': 'mustache',
      '.njk': 'nunjucks',
      '.liquid': 'liquid',
      '.hbs': 'handlebars',
      '.html': 'html',
    },
    twig: {
      alterFile: 'php/alter-twig.php',
    },
  },
  css: {
    enabled: true,
    includeComponentFiles: true,
    entryFile: 'src/scss/style.scss',
    outputFile: 'app.css',
    baseFiles: [],
    loadPaths: [],
  },
  js: {
    compiler: 'esbuild',
    enabled: true,
    bundle: true,
    includeComponentFiles: true,
    entryFile: null,
    outputFile: 'app.js',
    target: ['es2020'],
    targetQuery: null,
    baseFiles: [],
  },
  output: {
    componentsDir: 'components',
    treeFile: 'tree.json',
    manifestFile: 'components.json',
    indexFile: 'index.html',
  },
  server: {
    port: 3000,
  },
  plugins: [],
  clients: {},
  build: {
    renderConcurrency: 4,
  },
};

const normalizeTargetArray = (targets) => {
  if (!Array.isArray(targets)) return [];
  return targets
    .filter((target) => typeof target === 'string' && target.trim() !== '')
    .map((target) => target.trim());
};

const normalizeJsCompiler = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return { compiler: 'esbuild', warning: null };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'esbuild') {
    return { compiler: 'esbuild', warning: null };
  }

  return {
    compiler: 'esbuild',
    warning: `Unsupported js.compiler "${value}". Falling back to "esbuild".`,
  };
};

const resolveJsTargets = (jsConfig) => {
  const warnings = [];
  const explicitTargets = normalizeTargetArray(jsConfig?.target);
  if (explicitTargets.length > 0) {
    return { target: explicitTargets, warnings };
  }

  const queryCandidates = [];
  if (typeof jsConfig?.targetQuery === 'string' && jsConfig.targetQuery.trim()) {
    queryCandidates.push({ value: jsConfig.targetQuery, field: 'targetQuery' });
  }
  if (typeof jsConfig?.target === 'string' && jsConfig.target.trim()) {
    queryCandidates.push({ value: jsConfig.target, field: 'target' });
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
    } catch {
      warnings.push(
        `Invalid js.${queryCandidate.field} browserslist query "${queryCandidate.value}".`,
      );
    }
  }

  return { target: ['es2020'], warnings };
};

const normalizePort = (value) => {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  return 3000;
};

const sanitizeTemplateEngines = (enginesConfig, configWarnings) => {
  const engines = {};
  for (const [ext, engine] of Object.entries(enginesConfig ?? {})) {
    if (typeof ext !== 'string' || !ext.startsWith('.')) {
      configWarnings.push(`Invalid templating engine extension key "${ext}" ignored.`);
      continue;
    }
    if (typeof engine !== 'string' || !engine.trim()) {
      configWarnings.push(`Invalid templating engine value for "${ext}" ignored.`);
      continue;
    }
    engines[ext] = engine.trim().toLowerCase();
  }
  if (Object.keys(engines).length === 0) {
    configWarnings.push('No valid templating.engines configured. Restoring defaults.');
    return { ...DEFAULT_CONFIG.templating.engines };
  }
  return engines;
};

const normalizePlugins = (plugins, configWarnings) => {
  if (!Array.isArray(plugins)) return [];
  return plugins.filter((pluginPath) => {
    const valid = typeof pluginPath === 'string' && pluginPath.trim() !== '';
    if (!valid) configWarnings.push('Ignored invalid plugin path entry.');
    return valid;
  });
};

const resolvePathStructure = (repoRoot, pathsConfig, configWarnings) => {
  const srcRoot = path.resolve(repoRoot, pathsConfig.srcRoot || 'src');
  const componentsRoot = path.resolve(srcRoot, pathsConfig.componentsRoot || 'components');
  const dataRoot = path.resolve(srcRoot, pathsConfig.dataRoot || 'data');
  const assetsRoot = path.resolve(srcRoot, pathsConfig.assetsRoot || 'assets');
  const distRoot = path.resolve(repoRoot, pathsConfig.distRoot || 'dist');
  const templatesRoot = path.resolve(repoRoot, pathsConfig.templatesRoot || 'scripts/templates');
  const componentHeadPath = path.resolve(srcRoot, pathsConfig.componentHeadFile || '_component-head.html');

  if (!fs.existsSync(componentsRoot)) {
    configWarnings.push(`components root does not exist: ${toPosix(path.relative(repoRoot, componentsRoot))}`);
  }
  if (!fs.existsSync(templatesRoot)) {
    configWarnings.push(`templates root does not exist: ${toPosix(path.relative(repoRoot, templatesRoot))}`);
  }

  return {
    srcRoot,
    componentsRoot,
    dataRoot,
    assetsRoot,
    distRoot,
    templatesRoot,
    componentHeadPath,
  };
};

const resolveClientConfig = (fullConfig, client) => {
  if (!client) return fullConfig;
  const entry = fullConfig.clients?.[client];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return fullConfig;
  }
  return mergeDeep(fullConfig, entry);
};

export const loadPatternlabConfig = (repoRoot, { client = null } = {}) => {
  const configPath = path.join(repoRoot, 'patternlab.config.json');
  const loaded = readJsonSafe(configPath) ?? {};
  const pkg = readJsonSafe(path.join(repoRoot, 'package.json')) ?? {};
  const clientMerged = resolveClientConfig(mergeDeep(DEFAULT_CONFIG, loaded), client);
  const configWarnings = [];

  const pathConfig = resolvePathStructure(repoRoot, clientMerged.paths ?? {}, configWarnings);

  const cssBaseCandidates = normalizePathList(repoRoot, clientMerged.css?.baseFiles);
  const jsBaseCandidates = normalizePathList(repoRoot, clientMerged.js?.baseFiles);

  const cssBaseFiles = cssBaseCandidates.flatMap((candidate) =>
    collectFilesByExtension(candidate, new Set(['.scss', '.css'])),
  );
  const jsBaseFiles = jsBaseCandidates.flatMap((candidate) =>
    collectFilesByExtension(candidate, new Set(['.js', '.mjs', '.cjs'])),
  );

  const cssLoadPaths = normalizePathList(repoRoot, clientMerged.css?.loadPaths).filter(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
  );

  const { compiler: jsCompiler, warning: jsCompilerWarning } =
    normalizeJsCompiler(clientMerged.js?.compiler);
  if (jsCompilerWarning) configWarnings.push(jsCompilerWarning);

  const { target: jsTargets, warnings: jsTargetWarnings } = resolveJsTargets(clientMerged.js);
  configWarnings.push(...jsTargetWarnings);

  const templateEngines = sanitizeTemplateEngines(
    clientMerged.templating?.engines,
    configWarnings,
  );

  const resolvedPlugins = normalizePlugins(clientMerged.plugins, configWarnings);

  if (client && !clientMerged.clients?.[client]) {
    configWarnings.push(`Requested unknown client profile "${client}". Using base config.`);
  }

  return {
    ...clientMerged,
    packageVersion: typeof pkg.version === 'string' ? pkg.version : '',
    client,
    paths: {
      ...clientMerged.paths,
      ...pathConfig,
    },
    templating: {
      ...clientMerged.templating,
      engines: templateEngines,
      twig: {
        ...clientMerged.templating?.twig,
        alterFile: resolveOptionalFile(repoRoot, clientMerged.templating?.twig?.alterFile),
      },
    },
    server: {
      ...clientMerged.server,
      port: normalizePort(clientMerged.server?.port),
    },
    css: {
      ...clientMerged.css,
      entryFile: resolveOptionalFile(repoRoot, clientMerged.css?.entryFile),
      outputFile: normalizeOutputFile(clientMerged.css?.outputFile, 'app.css'),
      baseFiles: cssBaseFiles,
      loadPaths: cssLoadPaths,
    },
    js: {
      ...clientMerged.js,
      compiler: jsCompiler,
      bundle: clientMerged.js?.bundle !== false,
      entryFile: resolveOptionalFile(repoRoot, clientMerged.js?.entryFile),
      outputFile: normalizeOutputFile(clientMerged.js?.outputFile, 'app.js'),
      target: jsTargets,
      baseFiles: jsBaseFiles,
    },
    output: {
      ...clientMerged.output,
      componentsDir: normalizeOutputFile(clientMerged.output?.componentsDir, 'components'),
      treeFile: normalizeOutputFile(clientMerged.output?.treeFile, 'tree.json'),
      manifestFile: normalizeOutputFile(clientMerged.output?.manifestFile, 'components.json'),
      indexFile: normalizeOutputFile(clientMerged.output?.indexFile, 'index.html'),
    },
    plugins: resolvedPlugins,
    _meta: {
      titleWithVersion:
        typeof pkg.version === 'string' && pkg.version
          ? `${clientMerged.title} v${pkg.version}`
          : clientMerged.title,
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
