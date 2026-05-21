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
- **JSON data** — each component can have a matching `.json` file. A root `src/_global.json` provides data to every component. Folder-level `_global.json` files cascade into all components within that folder.
- **Variations** — use `~` in the filename to create component variations:
  - `button~outline.json` — JSON-only variation; inherits the base template and deep-merges JSON.
  - `button~ghost.twig` (+ optional `button~ghost.json`) — template variation with its own markup.
- **SCSS / JS pipeline** — place `.scss` and `.js` files alongside components. They are compiled and merged into `dist/app.css` and `dist/app.js` automatically.
- **Dark mode** — toggle in the header. Remembers preference in `localStorage`. Component iframes sync the theme via `postMessage`.
- **Richer navigation** — click a folder to see all its components in a grid view. Click a component to preview it in a full iframe. Supports multi-level hierarchies (e.g. `atoms/buttons/button-circle`).
- **Assets folder** — put example images, fonts, and brand media in `src/assets/`. They are copied to `dist/assets/`.

## Project structure

```
src/
  _global.json              # Global data available to every component
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
npm run dev       # Build + serve
```

Open `http://localhost:3000` to browse and preview components.

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Walk `src/components/`, render templates, compile SCSS, copy assets |
| `npm run serve` | Serve `dist/` on port 3000 (env `PORT` overrides) |
| `npm run dev` | Build then serve |
| `npm test` | Run integration tests |

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

## Optional full Twig engine

`php/render.php` has a safe fallback renderer for basic Twig (`{{ variable }}`, `{% include %}`, `{% if %}`, `{% for %}`).

For full Twig syntax support (filters, extensions, etc.), install Twig via Composer:

```bash
cd php && composer install
```

