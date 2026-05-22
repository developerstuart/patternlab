import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

const TEMPLATE_EXTS = new Set(['.twig', '.mustache', '.njk', '.liquid', '.hbs', '.html']);

export const contentType = (filePath) => {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return MIME[ext] ?? 'application/octet-stream';
};

export const isTemplateExt = (ext) => TEMPLATE_EXTS.has(ext);

export const loadLiveReloadSnippet = (repoRoot) =>
  fs.readFileSync(path.join(repoRoot, 'scripts', 'templates', 'live-reload-snippet.html'), 'utf8');
