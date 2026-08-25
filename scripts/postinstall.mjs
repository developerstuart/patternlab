import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Installs the PHP Twig renderer's Composer dependencies (php/vendor).
// Best-effort: a missing php/composer must never fail `npm install`, the
// renderer already falls back gracefully when php/vendor/autoload.php is absent.

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phpRoot = path.join(coreRoot, "php");
const autoload = path.join(phpRoot, "vendor", "autoload.php");

const skip = (reason) => {
  console.log(`patternlab: skipping composer install (${reason})`);
  process.exit(0);
};

if (process.env.PATTERNLAB_SKIP_COMPOSER === "1") skip("PATTERNLAB_SKIP_COMPOSER=1");
if (!fs.existsSync(path.join(phpRoot, "composer.json"))) skip("no php/composer.json");
if (fs.existsSync(autoload)) skip("php/vendor already installed");

const canRun = (cmd, args) =>
  spawnSync(cmd, args, { stdio: "ignore", shell: process.platform === "win32" }).status === 0;

if (!canRun("php", ["--version"])) skip("php not found on PATH");

// Prefer a global composer, fall back to a composer.phar sitting next to composer.json.
const phar = path.join(phpRoot, "composer.phar");
let command = "composer";
let baseArgs = [];

if (!canRun("composer", ["--version"])) {
  if (fs.existsSync(phar)) {
    command = "php";
    baseArgs = [phar];
  } else {
    skip("composer not found on PATH");
  }
}

const args = [
  ...baseArgs,
  "install",
  "--no-interaction",
  "--no-dev",
  "--prefer-dist",
  "--optimize-autoloader",
];

const result = spawnSync(command, args, {
  cwd: phpRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error || result.status !== 0) {
  console.warn(
    "patternlab: composer install failed; Twig templates will use the fallback renderer.\n" +
      "  Run `composer install` in php/ to enable the full Twig renderer.",
  );
}

process.exit(0);
