# Lab

A collection of small, self-contained browser demos and interaction experiments.
No build step, no dependencies — plain HTML, CSS and ES modules, hosted on GitHub Pages.

**Live:** https://babeltimeus-fu-rayjo.github.io/Lab/

## Demos

| Demo | What it shows |
| --- | --- |
| [Scratch Card](demos/scratcher/) | A canvas foil coating you rub away with the pointer (mouse, touch, pen) to reveal a picture. Tracks scratch progress and auto-reveals past a threshold. |

## Structure

```
index.html            Landing page — renders demo cards from the registry
assets/css/site.css   Shared theme: design tokens, buttons, layout
assets/js/demos.js    Demo registry (add an entry to list a new demo)
demos/<id>/           One self-contained demo per folder
scripts/serve.mjs     Zero-dependency local dev server
```

Each demo owns its own code. The scratch-card mechanic, for example, lives at
[`demos/scratcher/scratcher.js`](demos/scratcher/scratcher.js) — it is not a shared
library, so the demo folder is self-contained and portable.

## Adding a demo

1. Create `demos/<id>/` with its own `index.html` and any JS/CSS it needs.
2. Add an entry to [`assets/js/demos.js`](assets/js/demos.js) so it appears on the landing page.
3. Keep paths relative so everything works under the `/Lab/` GitHub Pages sub-path.

## Run locally

```bash
node scripts/serve.mjs 8080
```

Then open http://127.0.0.1:8080/. The server mirrors GitHub Pages: it serves the repo
root and `index.html` for directories.

## Hosting on GitHub Pages

Pages is served from the `main` branch root. The `.nojekyll` file disables Jekyll so
files are served exactly as they are. In the repo, **Settings → Pages → Build and
deployment**: Source = *Deploy from a branch*, Branch = `main` / `/ (root)`.
