import fs from 'node:fs';
import path from 'node:path';

export const readJsonSafe = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

export const readTextSafe = (filePath, fallback = '') => {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, 'utf8');
};

export const writeFileSafe = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

export const collectFilesRecursive = (targetPath, predicate = () => true) => {
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
    if (!predicate(absPath)) return;
    output.push(absPath);
  };
  walk(targetPath);
  return output;
};

export const collectFilesByExtension = (targetPath, extensions) =>
  collectFilesRecursive(targetPath, (absPath) =>
    extensions.has(path.extname(absPath)),
  );

export const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
};

export const getMtimeMs = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
};
