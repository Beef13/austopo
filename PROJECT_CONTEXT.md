# AusTopo — Project Context (for a new agent/session)

This file is a hand-off note so a fresh Cursor agent (e.g. on another computer) can
pick up quickly. It summarises what the project is, its current state, key
decisions, and what we were discussing next. For feature-level detail see
`README.md`.

## What it is

AusTopo is a web-based topographic map viewer for Australia — think an "Ordnance
Survey for Australia" built from open data. It's a PWA (installable, works
offline). Intended to be **shipped to the public**.

- **Live site:** https://austopo.vercel.app
- **Repo:** https://github.com/Beef13/austopo (branch `main`)
- **Hosting:** Vercel, which **auto-deploys on every push to `main`**. Be careful
  pushing broken code — it goes straight to production.

## Current status (what works)

- Pan/zoom map framed on Australia, GPS locate + follow, place search (Nominatim).
- **Base layers** (switcher, bottom-right):
  - **Topo** — MapTiler (see cartography note below). Default when a MapTiler key
    is configured.
  - **OpenTopo** — OpenTopoMap raster (free fallback).
  - **Satellite** — Esri World Imagery.
  - **GA Topo** — Geoscience Australia topographic basemap.
  - **Relief** — hillshade overlay (terrain-DEM), toggle on top of any base.
- **Coordinate readout** (bottom centre): lat/lon + MGA/UTM grid + live centre
  elevation (Open-Meteo). Tap to copy.
- **Routes**: draw, elevation profile, GPX import/export, save/load locally.
- **Pins/waypoints**: drop, drag, rename, delete, export.
- **Track recording**: live GPS track → save as route or export GPX.
- **Offline**: download map regions for offline use; "new version available"
  update prompt; offline status badge.
- **Share**: shareable URL that encodes view state (lat/lng/zoom/layer).

## Tech stack

- Vite + React + TypeScript.
- MapLibre GL JS **pinned to 5.24.x** (v6 had a GeoJSON rendering regression with
  Vite in this project — do not bump to v6 without re-testing route/pin/track
  layers).
- `vite-plugin-pwa` (Workbox) for the service worker / offline caching.
- `proj4` for MGA/UTM grid conversion.
- Data sources: MapTiler, Esri, Geoscience Australia, OpenTopoMap, Open-Meteo
  (elevation), AWS terrain tiles (hillshade), Nominatim (search).

## Environment setup (IMPORTANT for a new machine)

The MapTiler key is **not** in git (`.env` is gitignored). After cloning:

```bash
npm install
# create austopo/.env with the key (get value from the project owner / Vercel
# env vars — it's the same domain-restricted client key used in production):
echo "VITE_MAPTILER_KEY=<paste-key-here>" > .env
npm run dev
```

- The key is a **public, domain-restricted** client key (it ships in the browser
  bundle by design — that's how `VITE_` vars work). It is restricted by HTTP
  origin in the MapTiler dashboard. Make sure the allowlist includes
  `http://localhost:*`, `https://austopo.vercel.app`, and `https://*.vercel.app`.
- Production key lives in **Vercel → Project → Settings → Environment Variables**
  as `VITE_MAPTILER_KEY`. It is baked in at **build time**, so changing it
  requires a redeploy.
- Gotcha we already hit: if the Topo layer is a white screen in production, it's
  almost always a MapTiler 403 — either the Vercel env value is wrong (check for
  stray quotes/whitespace) or the origin isn't on the key's allowlist.

## Cartography note — Topo layer is now a VECTOR style

Recent work (see `src/lib/mapStyle.ts`): the MapTiler "Topo" base is rendered as a
**vector style** fetched at runtime (`buildStyle()` fetches
`maps/topo-v2/style.json`, splices its sources/layers in, tagged with
`metadata.base = 'maptiler'` so `LayerSwitcher` can toggle the whole group).

- Why: vector stays crisp at every zoom/DPI and is tunable, unlike raster tiles
  which look soft/"bland" when upscaled.
- **Fallback chain**: if the vector style fetch fails (offline first-run, quota,
  outage) → falls back to raster MapTiler tiles (`maptilerTileUrl`); if the whole
  `buildStyle()` fails → `MapView.tsx` falls back to `OPENTOPO_STYLE`
  (raster-only). A 4s timeout guarantees the UI appears even if `load` never
  fires.
- We deliberately **do not use @2x/retina** tiles for the raster fallback to keep
  MapTiler quota + offline download sizes low (public-shipping consideration).

### Verifying the map renders

The Cursor embedded browser is flaky at mounting this app (blank root, stale CDP
context, screenshot timeouts). Prefer the headless Playwright check:

```bash
npm run dev -- --port 5199   # in one shell
node scripts/verify-map.mjs  # in another; writes /tmp/austopo-verify.png
```

It reports MapTiler request counts (`pbf`/`sprite`/`styleJson`/`png`), any 403s,
page errors, active layer, and a screenshot. NOTE: `scripts/verify-map.mjs`
imports `playwright`, which is currently not a saved dependency — install it
(`npm i -D playwright && npx playwright install chromium`) if the script fails.

## Known caveats / things to watch

- **Offline + vector**: the offline region downloader (`src/lib/tiles.ts`) still
  enumerates **raster** MapTiler tiles. The on-screen Topo base is now vector, so
  offline for the Topo layer isn't a perfect match (vector needs tiles + glyphs +
  sprite cached). Runtime caching in `vite.config.ts` covers `api.maptiler.com`,
  but a proper offline-vector story may need more work. The free layers
  (OpenTopo/GA/Satellite) offline-download fine as raster.
- **MapTiler free tier is capped** (~100k tile loads/month). For public traffic
  this can be exceeded; the app degrades to free layers if MapTiler starts
  403ing. Consider making a free layer the default, or upgrading the plan, if
  usage grows.

## What we were discussing next (open threads)

1. **Custom cartography** — user wants an AllTrails-quality look. Research found
   **AllTrails uses Mapbox** (custom Mapbox Studio vector style over OSM + their
   own derived trail database). Our equivalent is the vector MapTiler Topo style
   now in place; further options discussed:
   - **Option A**: build a custom style in the MapTiler editor (visual, low-risk,
     one-line change our side to swap the style ID).
   - **Option B**: hand-tune the vector style in code (crispest/most control;
     what's now partly in place).
   - **Hybrid**: vector on-screen + raster fallback for offline.
   - Alternatively, switch provider to Mapbox (Outdoors style is close to
     AllTrails out of the box) — bigger change (new key/limits, re-plumb offline).
2. **Route-following** feature (off-route alerts + progress while navigating a
   saved route) — proposed but not started.

## Key files

- `src/lib/mapStyle.ts` — base layers, sources, `buildStyle()` vector assembly,
  fallbacks, Australia bounds/center.
- `src/components/MapView.tsx` — map init (async style), controls, ready/fallback.
- `src/components/LayerSwitcher.tsx` — base/relief toggling (group-aware).
- `src/lib/tiles.ts` — offline tile math + downloader.
- `src/lib/elevation.ts` — Open-Meteo elevation (retry/backoff, gap-filling).
- `src/lib/grid.ts` — lat/lon + MGA/UTM formatting.
- `src/components/{RouteTool,PinTool,TrackRecorder,CoordinateReadout,ShareControl,OfflinePanel,UpdatePrompt}.tsx`
- `vite.config.ts` — PWA config + Workbox runtime caching for tile hosts.
- `scripts/verify-map.mjs` — headless render verification.

## Workflow reminder

`git pull` when starting, `git push` when done. Push to `main` = production
deploy. Only commit when the user asks.
