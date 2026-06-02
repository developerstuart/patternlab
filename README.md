# Pattern Lab Core

Reusable Pattern Lab core engine built on Node.js + PHP Twig rendering.

This repository is the **core package**. Consumer repositories install it and own their own components, data, assets, styles, and plugins.

## What core provides

- CLI: `patternlab build`, `patternlab serve`, `patternlab dev`
- Rendering pipeline for Twig/Mustache/Nunjucks/Liquid/HTML templates (see [Template engines](#template-engines) for the Handlebars caveat)
- Component/variation discovery and data merging
- Aggregated CSS/JS build pipeline
- Browser preview UI shell and generated artifacts
- In-app component source viewer (template/SCSS/JS/data) with optional syntax highlighting
- Dev server with live reload and incremental rebuild support

## What consumer repos provide

- `src/components/`
- `src/data/`
- `src/assets/`
- `src/scss/`
- `patternlab.config.json`
- Optional consumer plugins

See [CONSUMER.md](./CONSUMER.md) for the full contract and distribution options.

## CLI usage

```bash
patternlab build       # one-off full build into distRoot
patternlab serve       # serve the existing build (no watching)
patternlab dev         # build components modified since last build, then serve + watch
patternlab dev:full    # full rebuild, then serve + watch
patternlab dev:styles  # serve + watch, rebuilding styles only
patternlab help        # print usage
```

`dev` performs an incremental `modified-components` build on startup (only
re-rendering component pages whose sources changed since the last build), then
watches `srcRoot` and rebuilds incrementally. Use `dev:full` when you want a
clean rebuild on startup.

CLI root/config resolution:

- Default root: current working directory
- Override root: `--root <path>` or `PATTERNLAB_ROOT`
- Config path: `--config <path>` or `PATTERNLAB_CONFIG`

All consumer paths resolve from the consumer root. Missing optional paths are skipped; they are not treated as hard errors.

## Local development in this repo

```bash
npm install
npm run build
npm run serve
npm run dev
npm test
```

## Authoring components

Components live under `src/components/` (configurable via `paths.componentsRoot`).
Discovery is convention-based:

- **Base component** — a template file whose name has no `~`, e.g.
  `button.twig`. An optional sibling `button.json` provides its render context.
- **Variations** — `<base>~<name>.<ext>`:
  - `button~ghost.twig` (+ optional `button~ghost.json`) — a variation with its
    own template.
  - `button~outline.json` (no template) — a JSON-only variation that reuses the
    base template with different data.
- **Folders** group components and may nest. Folder labels/order come from a
  `_meta.md` file in the folder.
- **Files and folders starting with `_`** (and `.gitkeep`) are ignored by
  discovery — use this for partials and includes.

### Component & folder metadata (`_meta.md` / `<name>.md`)

Metadata is YAML frontmatter in a Markdown file. A folder uses `_meta.md`; a
component uses `<name>.md` (e.g. `button.md`). Supported keys:

| Key | Applies to | Effect |
| --- | --- | --- |
| `title` | folder, component | Display label (defaults to a humanized file/folder name) |
| `order` | folder, component | Sort order within its parent (default `999`) |
| `hidden` | folder, component | When `true`, excluded from the build/UI |
| `card_display` | folder, component | `normal` or `full` preview card sizing; inherited by children. `cardDisplay` / `card-display` are also accepted |

### Data merging

Render context for each item is merged (deepest wins) in this order:

1. Global data — `src/data/**/*.json` and a legacy `src/_global.json`
2. Cascading folder data — `_global.json` in each ancestor component folder
3. Base component JSON — `<base>.json`
4. Variation JSON — `<base>~<name>.json`

## Template engines

Engines are mapped by file extension in `templating.engines`. Defaults:

| Extension | Engine | Notes |
| --- | --- | --- |
| `.twig` | `twig` | Rendered via the bundled PHP renderer (`php/render.php`); requires `php` on `PATH` |
| `.mustache` | `mustache` | |
| `.njk` | `nunjucks` | |
| `.liquid` | `liquid` | |
| `.hbs` | `handlebars` | **Caveat:** there is no real Handlebars engine — `.hbs` files are rendered through Mustache for basic `{{var}}` compatibility. Handlebars-specific features (helpers, `{{#each}}`, partials) are **not** supported. |
| `.html` | `html` | Passed through as-is |

## Configuration reference

All keys are optional and merged over the built-in defaults. Paths in `paths.*`
and `plugins` resolve from the consumer root.

```jsonc
{
  "title": "Pattern Lab",          // shown in the UI header

  "paths": {
    "srcRoot": "src",              // root for components/data/assets (relative to consumer root)
    "componentsRoot": "components",// relative to srcRoot
    "dataRoot": "data",            // relative to srcRoot
    "assetsRoot": "assets",        // relative to srcRoot; copied to distRoot/assets
    "distRoot": "dist",            // build output (relative to consumer root)
    "componentHeadFile": "_component-head.html" // optional extra <head> markup, relative to srcRoot
  },

  "templating": {
    "engines": { ".twig": "twig" }, // extension → engine map (merged with defaults)
    "twig": { "alterFile": null }   // optional consumer PHP file (see "Consumer Twig extension")
  },

  "css": {
    "enabled": true,
    "includeComponentFiles": true,  // bundle every component .scss found during discovery
    "entryFile": "src/scss/style.scss", // optional main entry compiled with @use glob expansion
    "outputFile": "app.css",        // written under distRoot
    "baseFiles": [],                // extra .scss/.css files or directories to include
    "loadPaths": []                 // additional Sass load paths (directories)
  },

  "js": {
    "enabled": true,
    "compiler": "esbuild",          // only "esbuild" is supported
    "bundle": true,                 // false = plain concatenation, no bundling
    "includeComponentFiles": true,  // include every component .js found during discovery
    "entryFile": null,              // optional main JS entry
    "outputFile": "app.js",         // written under distRoot
    "target": ["es2020"],           // explicit esbuild targets; takes precedence over targetQuery
    "targetQuery": null,            // browserslist query, only consulted when target is empty
    "baseFiles": []                 // extra .js/.mjs/.cjs files or directories to include
  },

  "ui": {
    "showDarkModeToggle": true,
    "showViewportControls": true,
    "enableResizeHandles": true,
    "code": {
      "enabled": true,                // show the "Code" view (template/SCSS/JS/data source) per component
      "highlight": true               // syntax-highlight the code view (inlines a small highlighter)
    },
    "toggles": [                    // custom attribute toggles rendered in the toolbar
      {
        "id": "theme",
        "type": "select",           // "select" or boolean toggle
        "label": "Theme",
        "attribute": "data-theme",  // attribute set on the target element
        "target": "html",
        "storageKey": "pl-theme",   // localStorage key for persistence
        "default": "default",
        "values": [ { "value": "default", "label": "Default" } ]
      }
    ],
    "preview": {
      "viewportPresets": { "full": null, "desktop": 1440, "tablet": 768, "mobile": 375 },
      "normalHeight": 220,
      "fullWidth": 1440,
      "fullHeight": 900,
      "fullMinHeight": 140,
      "fullMaxHeight": 280
    }
  },

  "output": {
    "componentsDir": "components",  // per-component HTML output dir under distRoot
    "treeFile": "tree.json",
    "manifestFile": "components.json",
    "indexFile": "index.html"
  },

  "server": {
    "port": 3000                    // dev server port; overridable with the PORT env var
  },

  "build": {
    "renderConcurrency": 4          // parallel render workers; override with --concurrency or PL_RENDER_CONCURRENCY
  },

  "plugins": []                     // consumer-relative plugin module paths
}
```

## Plugin hooks

Plugins are configured in `patternlab.config.json` and loaded from consumer-relative paths:

```json
{
  "plugins": ["plugins/example-plugin.mjs"]
}
```

Supported hook names:

- `beforeBuild`
- `afterBuild`
- `beforeDiscover`
- `afterDiscover`
- `beforeRenderItem`
- `afterRenderItem`
- `beforeWriteArtifacts`
- `afterWriteArtifacts`
- `beforeClassifyChange`
- `afterClassifyChange`

## Consumer Twig extension

Consumer repositories can extend Twig by providing a local alter file path in config:

```json
{
  "templating": {
    "twig": {
      "alterFile": "php/alter-twig.php"
    }
  }
}
```

This path is resolved relative to the consumer root (not core). If provided, the file should define `addCustomExtension(Environment &$env, $config)`.
