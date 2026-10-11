# Bulstroy Group: scroll-driven construction website

A one-page site for Bulstroy Group, a residential builder in Sofia (founded 2003). As you scroll, a photorealistic, path-traced film plays the construction of an apartment building from the first dig to handover:

| Stage | What happens on screen |
| --- | --- |
| 01 Survey & permits | An empty plot at sunrise; survey stakes, string lines and a total station; site hoarding and site offices arrive |
| 02 Excavation | Topsoil is stripped; a tracked excavator digs the pit and loads a dump truck; spoil heap |
| 03 Foundation | Rebar mat, raft pour, basement walls, waterproofing, backfill; the tower crane goes up |
| 04 Structure | Columns, core and slabs rise floor by floor (fresh concrete darkens, then cures), with formwork and edge-protection netting; the crane climbs and lifts loads |
| 05 Envelope | Stone bands, fins, glazing and staggered balconies are installed floor by floor; the penthouse and rooftop plant go on |
| 06 Finishing | The crane climbs down and is removed; the hoarding comes down; paving, lawns, hedges, a water feature and trees grow in |
| 07 Handover | Blue hour: the interiors, street lamps and the surrounding city light up |

The frames are rendered with **Blender Cycles** (free, open source) from the script in `render/`. All materials are procedural: concrete, soil, stone, glass, paint, asphalt and foliage. The site scrubs the frames with cross-fades and lays the stage cards, the live construction readout and the content sections on top. The page is bilingual: Bulgarian and English.

## Quickest way to view

Download **`bulstroy-standalone.html`** and double-click it. It is the whole site in one file and needs no server or install. Rebuild it after editing with `npm i esbuild && node tools/build-standalone.mjs`.

## Render the film yourself (higher quality)

The frames in `frames/` were rendered on a CPU (1280×720, 28 samples). On a PC with an NVIDIA or AMD GPU you can render a sharper version:

```bash
# with Blender 5.x installed
blender -b -P render/render.py -- --frames 180 --width 1920 --height 1080 --samples 128 --gpu
# or without the Blender app
pip install bpy==5.2.2 && python render/render.py --frames 180 --width 1920 --height 1080 --samples 128 --gpu
```

Add `--only 0.2,0.6,1` to render quick preview stills. Frames that already exist are skipped, so you can stop and resume the render. If you change `--frames`, update `count` in `js/config.js` to match.

## Run locally (development)

The page uses ES modules and an import map, so open it through a web server. Opening it as `file://` will not work.

```bash
npx http-server . -p 8080 -c-1   # or: python3 -m http.server 8080
# open http://localhost:8080
```


## Deploy

The site is fully static: upload the repository as-is to any static host (Netlify, Vercel, GitHub Pages, S3, nginx). There is no build step. The rendered frames (`frames/`, about 11 MB) load progressively, coarse to fine, so the whole timeline is scrubbable within seconds. Only the fonts load from Google Fonts.

## Structure

```
index.html            markup, all copy hooks (data-i18n)
css/style.css         design system + responsive layout
js/main.js            scroll loop, HUD numbers
js/sequence.js        frame loader + cross-fading canvas player
js/ui.js              scroll→progress, stage cards, HUD, i18n, form
js/i18n.js            EN / BG copy
js/config.js          contact settings (CONFIRM BEFORE LAUNCH) + frame count
js/timeline.js        stage ranges + construction milestones
frames/               rendered film (f0000.webp …)
render/               Blender scene + render script (scene.py, materials.py, render.py)
tools/                single-file build
```

## Before going live — verify with the company

The live site (bulstroygroup.com) could not be reached while this was built, so the content comes from public business directories. Please confirm:

- **`js/config.js` → `email`**: `office@bulstroygroup.com` is a placeholder. The enquiry form opens a pre-filled email to this address. Add `phone` to show the phone row.
- **About section**: founded 2003 by eng. Georgi Evtimov; 70+ team members (EMIS listed 72 for 2024); the "Building of the Year" award in 2014.
- **Projects**: Nadezhda, Darvenitsa 5 and Krastova Vada, all marked "In sales". Real photos or renders can replace the line drawings in `.project__art`.
- **Office address**: given as Izgrev, Sofia.
- The form has no backend; it uses `mailto:`. To store enquiries, point it at your CRM or a form service.

## Performance notes

- The page draws only when the scroll position changes, and it pauses in background tabs.
- Frames stream in coarse-to-fine; the page opens after the first 24 frames have loaded.
- `prefers-reduced-motion` turns off scroll smoothing, film grain and reveal animations.

## Preview

Frames from headless Chromium (software rendering; a real GPU will look smoother):

| | |
|---|---|
| ![Hero](docs/preview/01-hero.png) | ![Excavation](docs/preview/02-excavation.png) |
| ![Structure](docs/preview/03-structure.png) | ![Envelope](docs/preview/04-envelope.png) |
| ![Handover](docs/preview/05-handover.png) | ![Mobile](docs/preview/06-mobile.png) |
