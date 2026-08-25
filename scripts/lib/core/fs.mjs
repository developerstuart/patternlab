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

// Mirror `src` into `dest`: copy files whose size or mtime differ, and delete
// anything in `dest` that no longer exists in `src`. Unlike copyDir this prunes,
// so assets removed between runs do not linger in dist.
export const syncDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const srcEntries = fs.readdirSync(src, { withFileTypes: true });
  const keep = new Set(srcEntries.map((entry) => entry.name));

  if (fs.existsSync(dest)) {
    for (const entry of fs.readdirSync(dest)) {
      if (keep.has(entry)) continue;
      fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
    }
  }

  for (const entry of srcEntries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // A file replaced by a directory of the same name must not block the copy.
      if (fs.existsSync(d) && !fs.statSync(d).isDirectory()) fs.rmSync(d, { force: true });
      syncDir(s, d);
      continue;
    }
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) fs.rmSync(d, { recursive: true, force: true });
    const srcStat = fs.statSync(s);
    const destStat = fs.existsSync(d) ? fs.statSync(d) : null;
    if (destStat && destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) continue;
    fs.copyFileSync(s, d);
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
