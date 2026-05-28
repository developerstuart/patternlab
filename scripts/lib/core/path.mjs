import fs from 'node:fs';
import path from 'node:path';

export const toPosix = (value) => String(value).split(path.sep).join('/');

export const normalizePathList = (repoRoot, items) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => path.resolve(repoRoot, item));
};

export const normalizeOutputFile = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized || fallback;
};

export const resolveOptionalFile = (repoRoot, filePath) => {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;
  const resolved = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(resolved)) return null;
  if (!fs.statSync(resolved).isFile()) return null;
  return resolved;
};

export const resolveOptionalDirectory = (repoRoot, dirPath) => {
  if (typeof dirPath !== 'string' || dirPath.trim() === '') return null;
  const resolved = path.resolve(repoRoot, dirPath);
  if (!fs.existsSync(resolved)) return null;
  if (!fs.statSync(resolved).isDirectory()) return null;
  return resolved;
};

export const toPublicAssetPath = (value) =>
  `/${toPosix(String(value).replace(/^\/+/, ''))}`;
