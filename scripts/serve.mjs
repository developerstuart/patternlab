import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentType,
  isTemplateExt,
  loadLiveReloadSnippet,
} from "./lib/serve-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const componentsRoot = path.join(srcRoot, "components");
const assetsRoot = path.join(srcRoot, "assets");
const distRoot = path.join(repoRoot, "dist");
const buildScript = path.join(repoRoot, "scripts", "build.mjs");
const port = Number(process.env.PORT || 3000);
const watchMode = process.argv.includes("--watch");
const sinceLastBuildMode =
  process.argv.includes("--since-last-build") ||
  process.argv.includes("--changed-components");
const LIVE_RELOAD_SNIPPET = loadLiveReloadSnippet(repoRoot);

const runBuild = (args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn("node", [buildScript, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Build exited with code ${code}`));
    });
  });

const toPosix = (v) => v.split(path.sep).join("/");

const clients = new Set();
const broadcastReload = () => {
  const data = `data: ${JSON.stringify({ type: "reload" })}\n\n`;
  for (const res of clients) res.write(data);
};

const watchers = new Map();
const ensureDirWatch = (dir) => {
  if (
    watchers.has(dir) ||
    !fs.existsSync(dir) ||
    !fs.statSync(dir).isDirectory()
  )
    return;
  const watcher = fs.watch(dir, (eventType, filename) => {
    const changed = filename ? path.join(dir, String(filename)) : dir;
    queueChange(eventType, changed);
    refreshDirectoryWatchers();
  });
  watchers.set(dir, watcher);
};

const refreshDirectoryWatchers = () => {
  const desired = new Set();
  const stack = [srcRoot];
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

const copyFileSafe = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
};

const removePathSafe = (target) => {
  fs.rmSync(target, { recursive: true, force: true });
};

let pending = [];
let flushTimer = null;
let processing = false;
let processAgain = false;

const queueChange = (eventType, changedPath) => {
  pending.push({ eventType, changedPath });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(processChanges, 120);
};

const classifyChange = ({ eventType, changedPath }) => {
  const abs = path.resolve(changedPath);
  if (!abs.startsWith(srcRoot)) return { action: "none" };

  if (abs.startsWith(assetsRoot)) {
    const rel = toPosix(path.relative(assetsRoot, abs));
    if (!rel || rel.startsWith("..")) return { action: "none" };
    const distTarget = path.join(distRoot, "assets", ...rel.split("/"));
    const exists = fs.existsSync(abs);
    return { action: "asset", src: abs, dist: distTarget, exists, eventType };
  }

  const relSrc = toPosix(path.relative(srcRoot, abs));
  const baseName = path.basename(abs);
  const ext = path.extname(abs);
  const exists = fs.existsSync(abs);

  if (
    relSrc === "_global.json" ||
    relSrc === "_component-head.html" ||
    relSrc.startsWith("data/")
  )
    return { action: "full" };

  if (abs.startsWith(componentsRoot)) {
    if (
      baseName === "_global.json" ||
      baseName === "_meta.md" ||
      baseName.endsWith(".md")
    )
      return { action: "full" };
    if (ext === ".scss" || ext === ".js")
      return { action: exists ? "styles" : "full" };
    if (ext === ".json" || isTemplateExt(ext)) {
      if (!exists || eventType === "rename") return { action: "full" };
      const relComp = toPosix(path.relative(componentsRoot, abs));
      return { action: "component", source: relComp };
    }
    return { action: "full" };
  }

  return { action: "full" };
};

const processChanges = async () => {
  flushTimer = null;
  if (processing) {
    processAgain = true;
    return;
  }
  processing = true;

  while (true) {
    processAgain = false;
    const changes = pending;
    pending = [];
    if (changes.length === 0) break;

    const classified = changes.map(classifyChange);
    if (classified.some((c) => c.action === "full")) {
      try {
        await runBuild([]);
        broadcastReload();
      } catch (err) {
        console.error("Build failed:", err.message);
      }
      continue;
    }

    try {
      for (const c of classified.filter((x) => x.action === "asset")) {
        if (c.exists) copyFileSafe(c.src, c.dist);
        else removePathSafe(c.dist);
      }
      if (classified.some((c) => c.action === "styles"))
        await runBuild(["--mode", "styles"]);
      const sources = [
        ...new Set(
          classified
            .filter((c) => c.action === "component")
            .map((c) => c.source),
        ),
      ];
      for (const source of sources)
        await runBuild(["--mode", "component", "--source", source]);
      if (classified.some((c) => c.action !== "none")) broadcastReload();
    } catch (err) {
      console.error("Incremental rebuild failed:", err.message);
    }

    if (!processAgain) break;
  }

  processing = false;
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname === "/__live") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(":\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(distRoot, relativePath));

  if (!filePath.startsWith(distRoot)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  if (watchMode && filePath.endsWith(".html")) {
    const html = fs.readFileSync(filePath, "utf8");
    const injected = html.includes("</body>")
      ? html.replace("</body>", `${LIVE_RELOAD_SNIPPET}\n</body>`)
      : `${html}\n${LIVE_RELOAD_SNIPPET}`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(injected);
    return;
  }

  res.writeHead(200, { "content-type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
});

const start = async () => {
  if (watchMode) {
    if (sinceLastBuildMode) {
      await runBuild(["--mode", "modified-components"]);
      console.log(
        "Initial build: updated components modified since last build",
      );
    } else {
      await runBuild([]);
    }
    refreshDirectoryWatchers();
    console.log("Watching src/ for changes with incremental rebuilds");
  }

  server.listen(port, () => {
    console.log(`Pattern Lab available at http://localhost:${port}`);
  });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
