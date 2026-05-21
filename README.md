# Pattern Lab (modern minimal)

A minimal modern Pattern Lab rebuild focused on:

- Node-based workflow
- Twig component templates rendered by PHP
- Atomic + custom component folders
- Browser-based component viewer

## Structure

- `src/components/atomic/**` for atomic-design components
- `src/components/custom/**` for project-specific components

Each `.twig` template can have a matching `.json` file for context data.

## Usage

```bash
npm run build
npm run serve
```

Open `http://localhost:3000` to browse and preview generated components.

## Optional full Twig engine

`php/render.php` has a safe fallback renderer for variables and includes.

If you want full Twig syntax support, install Twig in `php/`:

```bash
cd php
composer install
```
