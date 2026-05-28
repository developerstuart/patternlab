# Consumer contract for Pattern Lab Core

## Ownership model

### Consumer repository owns

- Component templates/data: `src/components/`
- Global data: `src/data/`
- Static assets: `src/assets/`
- Styles/scripts entry points: `src/scss/` and optional JS entry files
- `patternlab.config.json`
- Extension plugins

### Core package provides

- CLI commands (`build`, `serve`, `dev`, `dev:full`, `dev:styles`)
- Rendering/discovery/data-merge pipeline
- Preview UI generation (`index.html`, tree/manifest artifacts)
- Core shell templates (`scripts/templates/*`)
- Twig PHP renderer (`php/render.php`)

## Config + path resolution contract

- Consumer root defaults to current working directory.
- Root can be overridden via `--root <path>` or `PATTERNLAB_ROOT`.
- Config file defaults to `<root>/patternlab.config.json`.
- Config can be overridden via `--config <path>` or `PATTERNLAB_CONFIG`.
- `paths.*` entries are resolved from consumer root.
- `plugins` entries are resolved from consumer root.
- Core UI templates are always loaded from the installed core package, not consumer config.
- Missing optional consumer files/paths are skipped (not hard errors).

## Plugin API

Each plugin exports an object with optional hook functions. Hooks run in registration order.

### Build lifecycle hooks

- `beforeBuild(payload)`
  - Payload: `{ buildMode, changedSource, patternlabConfig }`
- `afterBuild(payload)`
  - Payload: `{ buildMode, changedSource, patternlabConfig, result }`

### Discovery/render hooks

- `beforeDiscover(payload)`
  - Payload: `{ componentsRoot, patternlabConfig }`
- `afterDiscover(payload)`
  - Payload: `{ tree, patternlabConfig }`
- `beforeRenderItem(payload)`
  - Payload: `{ item, componentHeadExtra }`
- `afterRenderItem(payload)`
  - Payload: `{ item, html }`
- `beforeWriteArtifacts(payload)`
  - Payload: `{ tree, renderables }`
- `afterWriteArtifacts(payload)`
  - Payload: `{ tree, renderables }`

### Dev incremental hooks

- `beforeClassifyChange(payload)`
  - Payload: `{ eventType, changedPath, action }`
- `afterClassifyChange(payload)`
  - Payload examples:
    - `{ action: 'none' }`
    - `{ action: 'full' }`
    - `{ action: 'styles' }`
    - `{ action: 'component', source }`
    - `{ action: 'asset', src, dist, exists, eventType }`

## Distribution models

## 1) Private package registry (recommended)

Best developer experience and cleanest updates.

```bash
npm install --save-dev @yourorg/patternlab-core
```

Consumer scripts:

```json
{
  "scripts": {
    "build": "patternlab build",
    "serve": "patternlab serve",
    "dev": "patternlab dev"
  }
}
```

Use semver tags/releases for upgrades (`1.1.0`, `1.2.0`, etc.).

## 2) Git dependency or submodule

Use when private registry is not available.

### Git dependency

```bash
npm install --save-dev github:yourorg/patternlab#v1.1.0
```

### Submodule

```bash
git submodule add <git-url> patternlab-core
```

Consumer scripts call the package CLI directly:

```json
{
  "scripts": {
    "build": "node node_modules/@yourorg/patternlab-core/bin/patternlab.mjs build",
    "serve": "node node_modules/@yourorg/patternlab-core/bin/patternlab.mjs serve"
  }
}
```

Prefer tagged versions for reproducible builds.
