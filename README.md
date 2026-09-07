# Lab

A collection of small, self-contained browser demos and interaction experiments.
No build step, no dependencies — plain HTML, CSS and ES modules, hosted on GitHub Pages.

**Live:** https://babeltimeus-fu-rayjo.github.io/Lab/

## Demos

| Demo | What it shows |
| --- | --- |
| [Scratch Card](demos/scratcher/) | A canvas foil coating you rub away with the pointer (mouse, touch, pen) to reveal a picture. Tracks scratch progress and auto-reveals past an adjustable threshold. |
| [Slot Machine](demos/slots/) | A configurable slot machine — set the number of reels, the rows per reel and the exact symbols, then spin. Reels blur, roll and settle with a staggered stop. Purely visual, no scoring. |
| [Spinning Wheel](demos/wheel/) | A configurable prize wheel — set the number of slices, each slice's width and the spin speed, then flick it. It eases to a stop under the pointer and reports the slice; a wider slice wins more often. |
| [Drop to Win](demos/drop/) | A Plinko board with simple 2D physics — balls fall through a peg field into prize slots that run hot toward the edges. Set the board width, height and how many balls drop; land a few hundred to trace a bell curve. |

## Structure

```
index.html               Landing page — renders demo cards from the registry
assets/css/site.css      Shared theme: design tokens, buttons, layout
assets/js/demos.js       Demo registry (add an entry to list a new demo)
demos/<id>/              One self-contained demo per folder
scripts/serve.mjs        Zero-dependency local dev server (also serves a live version.json)
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

Pages deploys from the `main` branch root (**Settings → Pages → Build and deployment**:
Source = *Deploy from a branch*, Branch = `main` / `/ (root)`). The `.nojekyll` file disables
Jekyll so files are served exactly as they are.

### Version in the footer

The landing-page footer shows the live commit short hash and a timestamp, linked to the commit,
so it's easy to tell which build is running. It has no build step: in production the page asks the
GitHub commits API for the latest commit on `main` (what Pages serves). Locally, the dev server
serves a live `version.json` from your working tree instead — including an "uncommitted changes"
marker when the tree is dirty — which the footer prefers when present.
