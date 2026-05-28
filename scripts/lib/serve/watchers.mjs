import fs from 'node:fs';
import path from 'node:path';

export const createRecursiveWatcher = ({ rootDir, onChange }) => {
  const watchers = new Map();

  const ensureDirWatch = (dir) => {
    if (watchers.has(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    const watcher = fs.watch(dir, (eventType, filename) => {
      const changed = filename ? path.join(dir, String(filename)) : dir;
      onChange(eventType, changed);
      refreshDirectoryWatchers();
    });
    watchers.set(dir, watcher);
  };

  const refreshDirectoryWatchers = () => {
    const desired = new Set();
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!fs.existsSync(dir)) continue;
      let stat;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      desired.add(dir);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
      }
    }

    for (const dir of desired) ensureDirWatch(dir);
    for (const [dir, watcher] of watchers) {
      if (desired.has(dir)) continue;
      watcher.close();
      watchers.delete(dir);
    }
  };

  const close = () => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };

  return {
    refreshDirectoryWatchers,
    close,
  };
};
