import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPatternlabConfig } from './config.mjs';
import { getArgValue } from './core/cli.mjs';

export const createRuntimeContext = ({ scriptUrl, argv = process.argv.slice(2) }) => {
  const __filename = fileURLToPath(scriptUrl);
  const scriptDir = path.dirname(__filename);
  const repoRoot = path.resolve(scriptDir, '..');
  const client = getArgValue(argv, '--client');
  const patternlabConfig = loadPatternlabConfig(repoRoot, { client });
  return {
    argv,
    repoRoot,
    scriptDir,
    client,
    patternlabConfig,
    paths: patternlabConfig.paths,
  };
};
