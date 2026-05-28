import fs from "node:fs";
import path from "node:path";

export const createIncrementalRebuilder = ({
  srcRoot,
  componentsRoot,
  assetsRoot,
  distRoot,
  isTemplateExt,
  runBuild,
  broadcastReload,
  toPosix,
  hooks,
  componentHeadPath,
}) => {
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

  const classifyChange = async ({ eventType, changedPath }) => {
    const abs = path.resolve(changedPath);
    let payload = { eventType, changedPath: abs, action: "none" };
    if (hooks) payload = await hooks.run("beforeClassifyChange", payload);

    if (!abs.startsWith(srcRoot))
      return hooks ? hooks.run("afterClassifyChange", payload) : payload;

    if (abs.startsWith(assetsRoot)) {
      const rel = toPosix(path.relative(assetsRoot, abs));
      if (!rel || rel.startsWith("..")) return { action: "none" };
      const distTarget = path.join(distRoot, "assets", ...rel.split("/"));
      const exists = fs.existsSync(abs);
      payload = {
        action: "asset",
        src: abs,
        dist: distTarget,
        exists,
        eventType,
      };
      return hooks ? hooks.run("afterClassifyChange", payload) : payload;
    }

    const relSrc = toPosix(path.relative(srcRoot, abs));
    const baseName = path.basename(abs);
    const ext = path.extname(abs);
    const exists = fs.existsSync(abs);

    if (
      relSrc === "_global.json" ||
      abs === componentHeadPath ||
      relSrc.startsWith("data/")
    ) {
      payload = { action: "full" };
      return hooks ? hooks.run("afterClassifyChange", payload) : payload;
    }

    if (!abs.startsWith(componentsRoot) && (ext === ".scss" || ext === ".js")) {
      payload = { action: "styles" };
      return hooks ? hooks.run("afterClassifyChange", payload) : payload;
    }

    if (abs.startsWith(componentsRoot)) {
      if (
        baseName === "_global.json" ||
        baseName === "_meta.md" ||
        baseName.endsWith(".md")
      ) {
        payload = { action: "full" };
        return hooks ? hooks.run("afterClassifyChange", payload) : payload;
      }
      if (ext === ".scss" || ext === ".js") {
        payload = { action: exists ? "styles" : "full" };
        return hooks ? hooks.run("afterClassifyChange", payload) : payload;
      }
      if (ext === ".json" || isTemplateExt(ext)) {
        if (!exists || eventType === "rename") {
          payload = { action: "full" };
          return hooks ? hooks.run("afterClassifyChange", payload) : payload;
        }
        const relComp = toPosix(path.relative(componentsRoot, abs));
        payload = { action: "component", source: relComp };
        return hooks ? hooks.run("afterClassifyChange", payload) : payload;
      }
      payload = { action: "full" };
      return hooks ? hooks.run("afterClassifyChange", payload) : payload;
    }

    payload = { action: "full" };
    return hooks ? hooks.run("afterClassifyChange", payload) : payload;
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

      const classified = [];
      for (const change of changes) {
        classified.push(await classifyChange(change));
      }

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

  const queueChange = (eventType, changedPath) => {
    pending.push({ eventType, changedPath });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(processChanges, 120);
  };

  return {
    queueChange,
    processChanges,
  };
};
