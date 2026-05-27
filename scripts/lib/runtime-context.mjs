import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPatternlabConfig } from './config.mjs';

export const createRuntimeContext = ({ scriptUrl, argv = process.argv.slice(2) }) => {
  const __filename = fileURLToPath(scriptUrl);
  const scriptDir = path.dirname(__filename);
  const repoRoot = path.resolve(scriptDir, '..');
  const patternlabConfig = loadPatternlabConfig(repoRoot);
  return {
    argv,
    repoRoot,
    scriptDir,
    patternlabConfig,
    paths: patternlabConfig.paths,
  };
};
