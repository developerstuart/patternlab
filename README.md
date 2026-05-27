# Pattern Lab (modern minimal)

A modern, minimal Pattern Lab built on Node.js — organise and preview UI components in the browser using any template engine.

## Features

- **Flexible folder structure** — any top-level folder under `src/components/` becomes a navigation section. No fixed atomic names required; add `atoms/`, `molecules/`, `organisms/`, `templates/`, or whatever you need.
- **Multiple template engines** — `.twig` (PHP), `.mustache` / `.hbs` (Mustache), `.njk` (Nunjucks), `.liquid` (Liquid), `.html` (pass-through).
- **Metadata files** — add a `_meta.md` file in any folder with YAML frontmatter to control display name, ordering, and visibility:
  ```md
  ---
  title: Atoms
  order: 1
  hidden: false
  ---
  ```
- **JSON data** — each component can have a matching `.json` file. Put shared data in `src/data/*.json` (supports multiple files and nested folders). Folder-level `_global.json` files still cascade into all components within that folder.
- **Variations** — use `~` in the filename to create component variations:
  - `button~outline.json` — JSON-only variation; inherits the base template and deep-merges JSON.
  - `button~ghost.twig` (+ optional `button~ghost.json`) — template variation with its own markup.
- **SCSS / JS pipeline** — place `.scss` and `.js` files alongside components. They are compiled and merged into `dist/app.css` and `dist/app.js` automatically.
- **Root config** — `patternlab.config.json` controls title/header behavior, key UI toggles, and CSS/JS pipeline options (including base files and Sass load paths).
- **Custom component `<head>` markup** — add `src/_component-head.html` to inject extra tags (for example Google/Adobe font stylesheets) into every generated component page.
- **Dark mode** — toggle in the header. Remembers preference in `localStorage`. Component iframes sync the theme via `postMessage`.
- **Live reload in dev** — `npm run dev` watches `src/` and uses incremental rebuilds where possible (assets copy, css/js rebuild, component-only rerender, full rebuild fallback).
- **Responsive preview controls** — component preview supports drag-resize and quick presets (full, desktop, tablet, mobile).
- **Richer navigation** — click a folder to see all its components in a grid view. Click a component to preview it in a full iframe. Supports multi-level hierarchies (e.g. `atoms/buttons/button-circle`).
- **Assets folder** — put example images, fonts, and brand media in `src/assets/`. They are copied to `dist/assets/`.

## Project structure

```
src/
  data/                     # Global data files merged into every component context
    site.json
  _component-head.html      # Optional extra tags for generated component page <head>
  assets/                   # Images, fonts, and other brand media
  components/
    atoms/                  # A component section (name is up to you)
      _meta.md              # Optional folder metadata (title, order, hidden)
      _global.json          # Optional data for all components in this folder
      button.twig           # Component template
      button.json           # Component data
      button~outline.json   # JSON-only variation (inherits button.twig)
      button~ghost.twig     # Template variation
      button~ghost.json     # Data for the ghost variation
      button.scss           # Component styles (compiled into app.css)
    molecules/
      _meta.md
      feature-card.twig
      feature-card.json
      feature-card.scss
```

## Quick start

```bash
npm run build     # Build dist/
npm run serve     # Serve dist/ at http://localhost:3000
npm run dev       # Serve with watch + live reload
npm run dev:full  # Watch mode with full rebuild startup
```

Open `http://localhost:3000` to browse and preview components.

## Scripts

| Command          | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `npm run build`  | Walk components, render templates, compile SCSS/JS, copy assets      |
| `npm run serve`  | Serve configured dist output on port 3000 (env `PORT` overrides)     |
| `npm run dev`    | Run dev server with src watcher, incremental rebuilds, and live reload |
| `npm run dev:full` | Run dev server in watch mode with full initial rebuild               |
| `npm run dev:styles` | Run dev server in watch mode focused on style/script iteration      |
| `npm test`       | Run integration tests                                                 |

## `patternlab.config.json`

Use `patternlab.config.json` in the repository root to control:

- `title` (displayed in Pattern Lab header)
- `ui.showThemeToggle`, `ui.showViewportControls`, `ui.enableResizeHandles`
- `css.enabled`, `css.includeComponentFiles`, `css.entryFile`, `css.outputFile`, `css.baseFiles`, `css.loadPaths`
- `js.compiler`, `js.enabled`, `js.bundle`, `js.includeComponentFiles`, `js.entryFile`, `js.outputFile`, `js.targetQuery`, `js.target`, `js.baseFiles`
- `paths.srcRoot`, `paths.componentsRoot`, `paths.dataRoot`, `paths.assetsRoot`, `paths.distRoot`, `paths.componentHeadFile`
- `templating.engines` and `templating.twig.alterFile`
- `output.componentsDir`, `output.treeFile`, `output.manifestFile`, `output.indexFile`
- `ui.preview.viewportPresets`, `ui.preview.normalHeight`, `ui.preview.fullWidth`, `ui.preview.fullHeight`, `ui.preview.fullMinHeight`, `ui.preview.fullMaxHeight`
- `plugins` lifecycle extensions

The package version from `package.json` is appended automatically in the header.

### JS bundling toggle

Use `js.bundle` to control whether `dist/app.js` is browser-bundled or raw-concatenated:

- `true` (default): bundles component and base JS with import resolution (recommended).
- `false`: concatenates raw files without resolving `import` statements (legacy mode).

Example:

```json
{
  "js": {
    "compiler": "esbuild",
    "enabled": true,
    "bundle": true,
    "includeComponentFiles": true,
    "entryFile": null,
    "outputFile": "app.js",
    "targetQuery": "last 2 versions",
    "baseFiles": []
  }
}
```

### Browser target and output file customization

- `js.compiler` currently supports `esbuild` and is validated during config load.
- Use `js.targetQuery` for Browserslist queries (for example, `last 2 versions`).
- Use `js.target` for explicit esbuild targets (`["chrome124","firefox126","safari17"]`).
- Use `css.outputFile` / `js.outputFile` to change emitted asset names and paths under `dist/`.
- Use `css.entryFile` / `js.entryFile` to configure custom primary entry files.
- Invalid `js.targetQuery` values print a warning and fall back to `es2020`.

## Skeleton contract

This project is intended to stay a reusable core skeleton:

1. **Core responsibilities**
   - Discover and render component templates.
   - Merge global + component + variation data.
   - Build aggregated CSS/JS outputs.
   - Generate preview UI and navigation artifacts.
   - Serve + live-reload with incremental rebuild support.
2. **Stable public surface**
   - `patternlab.config.json` keys documented in this README.
   - CLI contract: `build`, `serve`, `dev` scripts.
   - Plugin hook names in `scripts/lib/plugins.mjs`.
3. **Backward compatibility**
   - Existing default folder layout continues to work (`src/components`, `src/data`, `src/assets`, `dist`).
   - Legacy `src/_global.json` is still merged before `src/data/**/*.json`.
   - Existing component filename conventions and variation behavior are preserved.

## Config matrix (what to configure)

- **Required defaults (core):**
  - `title`, `paths.*`, `css.enabled`, `js.enabled`, `output.*`
- **Optional toggles (common):**
  - `ui.showModeToggle`, `ui.showThemeToggle`, `ui.showViewportControls`, `ui.enableResizeHandles`, `js.bundle`
- **Advanced overrides (power users):**
  - `templating.engines`, `templating.twig.alterFile`, `css/base/js entry + base files`, `ui.preview.*`, target browsers
- **Extension hooks:**
  - `plugins: ["relative/path/to/plugin.mjs"]`
  - Hooks: `beforeBuild`, `afterBuild`, `beforeDiscover`, `afterDiscover`, `beforeRenderItem`, `afterRenderItem`, `beforeWriteArtifacts`, `afterWriteArtifacts`, `beforeClassifyChange`, `afterClassifyChange`

## Migration notes

- `dev:changed` was removed; use `npm run dev` (incremental) or `npm run dev:full`.
- Config now supports path/output/templating/plugin groups. Existing configs remain valid with defaults.
- Twig alteration remains optional; configure custom file via `templating.twig.alterFile`.

## Adding a new section

Create a folder under `src/components/`:

```bash
mkdir src/components/organisms
```

Add an optional `_meta.md` for display name and ordering:

```md
---
title: Organisms
order: 3
---
```

Then add component files (`.twig`, `.json`, `.scss`) to the folder.

## Customizing generated component page `<head>`

Create `src/_component-head.html` to inject additional markup into every generated component page.  
This is useful for external stylesheets such as Google Fonts or Adobe Fonts.

## Optional full Twig engine

`php/render.php` has a safe fallback renderer for basic Twig (`{{ variable }}`, `{% include %}`, `{% if %}`, `{% for %}`).

For full Twig syntax support (filters, extensions, etc.), install Twig via Composer:

```bash
cd php && composer install
```
