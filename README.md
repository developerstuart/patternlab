# Pattern Lab Core

Reusable Pattern Lab core engine built on Node.js + PHP Twig rendering.

This repository is the **core package**. Consumer repositories install it and own their own components, data, assets, styles, and plugins.

## What core provides

- CLI: `patternlab build`, `patternlab serve`, `patternlab dev`
- Rendering pipeline for Twig/Mustache/Nunjucks/Liquid/HTML templates
- Component/variation discovery and data merging
- Aggregated CSS/JS build pipeline
- Browser preview UI shell and generated artifacts
- Dev server with live reload and incremental rebuild support

## What consumer repos provide

- `src/components/`
- `src/data/`
- `src/assets/`
- `src/scss/`
- `patternlab.config.json`
- Optional consumer plugins

See `/tmp/workspace/developerstuart/patternlab/CONSUMER.md` for the full contract and distribution options.

## CLI usage

```bash
patternlab build
patternlab serve
patternlab dev
```

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
