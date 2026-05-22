import fs from 'node:fs';
import path from 'node:path';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

export const mergeDeep = (...objs) => {
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

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const collectJsonFiles = (rootDir) => {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (path.extname(entry.name) === '.json') out.push(fullPath);
    }
  };
  walk(rootDir);
  return out;
};

export const loadRootGlobalData = (srcRoot) => {
  const dataDir = path.join(srcRoot, 'data');
  const jsonFiles = collectJsonFiles(dataDir);
  const merged = jsonFiles.reduce((acc, filePath) => mergeDeep(acc, readJson(filePath) ?? {}), {});
  const legacyGlobal = readJson(path.join(srcRoot, '_global.json')) ?? {};
  return mergeDeep(legacyGlobal, merged);
};
