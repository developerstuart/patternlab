import fs from 'node:fs';
import path from 'node:path';

export const parseFrontmatter = (raw) => {
  const m = raw.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/,
  );
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (val !== '' && !Number.isNaN(Number(val))) val = Number(val);
    if (key) meta[key] = val;
  }
  return { meta, body: m[2] };
};

export const readMeta = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  return parseFrontmatter(fs.readFileSync(filePath, 'utf8')).meta;
};

export const readFolderMeta = (dirPath) => {
  const canonical = path.join(dirPath, '_meta.md');
  if (fs.existsSync(canonical)) return readMeta(canonical);

  const folderNamed = path.join(dirPath, `_${path.basename(dirPath)}.md`);
  if (fs.existsSync(folderNamed)) return readMeta(folderNamed);

  const fallback = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.startsWith('_') && entry.name.endsWith('.md'),
    )
    .sort((a, b) => a.name.localeCompare(b.name))[0];

  if (!fallback) return {};
  return readMeta(path.join(dirPath, fallback.name));
};

export const toLabel = (stem) =>
  stem.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const normalizeCardDisplay = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'normal' || normalized === 'full' ? normalized : null;
};
