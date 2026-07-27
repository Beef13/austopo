# AusTopo

A fast, mobile-friendly web app for browsing **detailed topographic maps of Australia** — an "OS Maps"-style experience built on open data. Pan and zoom OpenTopoMap terrain, jump to your GPS location, and search for any place in Australia.

Built as an installable **PWA** so it can grow into offline map downloads and, eventually, a native app.

## Features

- Full-screen topographic map (OpenTopoMap style) framed on Australia
- Topo / Satellite base-layer switcher (Esri World Imagery)
- "Locate me" with live GPS tracking and a follow-the-dot mode
- Place search across Australia (OpenStreetMap Nominatim)
- Live centre-coordinate readout (lat/long + MGA/UTM grid reference), tap to copy
- Share this location: a link that restores the exact view (centre, zoom, layer)
- Offline maps: download the current area and use it with no signal
- Zoom + metric scale controls
- Installable to a phone home screen (PWA), with a "new version" reload prompt

## Tech stack

- [Vite](https://vite.dev/) + React + TypeScript
- [MapLibre GL JS](https://maplibre.org/) — open-source map renderer (no API keys)
- [OpenTopoMap](https://opentopomap.org/) raster tiles
- [Nominatim](https://nominatim.org/) geocoding
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) for the installable PWA

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # production build into dist/
npm run preview  # preview the production build
```

### Configuration — MapTiler basemap (recommended)

The primary **Topo** layer uses [MapTiler Outdoor](https://www.maptiler.com/maps/outdoor/)
for fast, high-detail tiles. It needs a free API key:

1. Create a key at <https://cloud.maptiler.com/account/keys/>.
2. In the MapTiler dashboard, **restrict the key** to your domains
   (e.g. `austopo.vercel.app` and `localhost`) — it ships to the browser.
3. Copy `.env.example` to `.env` and set `VITE_MAPTILER_KEY=your_key`.
4. For production (Vercel): add `VITE_MAPTILER_KEY` as an Environment Variable,
   then redeploy.

Without a key the app still runs and falls back to OpenTopoMap as the default
"Topo" layer — no configuration required.

## Data sources & attribution

This app relies on openly licensed data. Attribution is shown on the map and is **required** by the licenses:

- **Map tiles / style:** © [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA)
- **Map data:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, and SRTM elevation
- **Search:** [OpenStreetMap Nominatim](https://nominatim.org/)

## Usage-policy notes (important before going live)

- **MapTiler tiles** — used for the default Topo layer when `VITE_MAPTILER_KEY` is set. Covered by MapTiler's free tier for light use; check your usage in their dashboard and restrict the key to your domains.
- **OpenTopoMap tiles** — the public tile server (`tile.opentopomap.org`) is **fair-use only**, so it's now a fallback / alternative layer rather than the production default. Fine for development and light traffic. See `src/lib/mapStyle.ts`.
- **Nominatim** — limited to ~1 request/second and requires an identifying request. Search input is debounced (600 ms) and bounded to Australia (`countrycodes=au`) to stay within policy. For heavier use, run your own Nominatim instance.

## Project structure

```
src/
  components/
    MapView.tsx        # MapLibre map + OpenTopoMap tiles + controls
    SearchBar.tsx      # debounced Nominatim place search
    LocateControl.tsx  # GPS locate + follow mode
  lib/
    mapStyle.ts        # tile source, Australia view/bounds, attribution
    geocode.ts         # Nominatim geocoding client
  App.tsx              # app shell
```

## Offline maps

Open the download control (bottom-right), choose a detail level, and download the
current view. Tiles are fetched through the service worker and cached
(`CacheFirst`, cache name `map-tiles`), so any area you've downloaded — or simply
viewed — renders with no connection. Downloads are capped (4,000 tiles) to respect
tile-server fair-use; zoom in or lower the detail for large areas.

## Roadmap

- **Routes** — draw/save routes with distance and elevation profiles, GPX import/export
- **Bigger offline regions** — switch to PMTiles archives for whole-state downloads
- **Native app** — reuse this logic with MapLibre React Native, or wrap the PWA
