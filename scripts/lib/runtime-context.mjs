import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPatternlabConfig } from './config.mjs';

const getArgValue = (argv, name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
};

const resolveRoot = ({ argv, cwd, env }) => {
  const cliRoot = getArgValue(argv, '--root');
  const rootCandidate = cliRoot ?? env.PATTERNLAB_ROOT ?? cwd;
  return path.resolve(rootCandidate);
};

const resolveConfigPath = ({ argv, cwd, env, repoRoot }) => {
  const cliConfig = getArgValue(argv, '--config');
  const configCandidate =
    cliConfig ?? env.PATTERNLAB_CONFIG ?? path.join(repoRoot, 'patternlab.config.json');
  return path.resolve(cwd, configCandidate);
};

export const createRuntimeContext = ({
  scriptUrl,
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  root = null,
  configPath = null,
} = {}) => {
  const __filename = fileURLToPath(scriptUrl);
  const scriptDir = path.dirname(__filename);
  const coreRoot = path.resolve(scriptDir, '..');
  const repoRoot = root ? path.resolve(cwd, root) : resolveRoot({ argv, cwd, env });
  const resolvedConfigPath = configPath
    ? path.resolve(cwd, configPath)
    : resolveConfigPath({ argv, cwd, env, repoRoot });
  const patternlabConfig = loadPatternlabConfig({
    repoRoot,
    coreRoot,
    configPath: resolvedConfigPath,
  });
  return {
    argv,
    coreRoot,
    repoRoot,
    configPath: resolvedConfigPath,
    scriptDir,
    patternlabConfig,
    paths: patternlabConfig.paths,
  };
};
