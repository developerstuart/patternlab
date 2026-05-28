import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOOK_NAMES = [
  'beforeDiscover',
  'afterDiscover',
  'beforeRenderItem',
  'afterRenderItem',
  'beforeWriteArtifacts',
  'afterWriteArtifacts',
  'beforeBuild',
  'afterBuild',
  'beforeClassifyChange',
  'afterClassifyChange',
];

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const ensurePluginObject = (pluginModule, pluginPath) => {
  const candidate = pluginModule?.default ?? pluginModule;
  if (!isObject(candidate)) {
    throw new Error(`Plugin at ${pluginPath} must export an object`);
  }
  return candidate;
};

export const loadPlugins = async (repoRoot, pluginPaths = []) => {
  const loaded = [];
  for (const pluginPath of pluginPaths) {
    const absPath = path.resolve(repoRoot, pluginPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`Configured plugin not found: ${pluginPath}`);
    }
    const pluginModule = await import(pathToFileURL(absPath).href);
    const plugin = ensurePluginObject(pluginModule, pluginPath);
    loaded.push({ path: absPath, plugin });
  }
  return loaded;
};

export const createHookRunner = (plugins = []) => {
  const byHook = new Map(HOOK_NAMES.map((name) => [name, []]));
  for (const { plugin, path: pluginPath } of plugins) {
    for (const hookName of HOOK_NAMES) {
      if (typeof plugin[hookName] !== 'function') continue;
      byHook.get(hookName).push({ fn: plugin[hookName], pluginPath });
    }
  }

  return {
    async run(hookName, payload) {
      const handlers = byHook.get(hookName) ?? [];
      let current = payload;
      for (const { fn, pluginPath } of handlers) {
        const next = await fn(current);
        if (next !== undefined) current = next;
        if (!isObject(current)) {
          throw new Error(
            `Plugin hook ${hookName} in ${pluginPath} must return an object when returning a value`,
          );
        }
      }
      return current;
    },
  };
};

export const supportedHookNames = HOOK_NAMES;
