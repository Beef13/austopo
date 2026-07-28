# AusTopo

A fast, mobile-friendly web app for browsing **detailed topographic maps of Australia** — an "OS Maps"-style experience built on open data. Pan and zoom OpenTopoMap terrain, jump to your GPS location, and search for any place in Australia.

Built as an installable **PWA** so it can grow into offline map downloads and, eventually, a native app.

## Features

**Maps & navigation**

- Full-screen topographic map framed on Australia, panning bounded to the region
- Base-layer switcher: **Topo** (MapTiler Outdoor when a key is set, else OpenTopoMap), **Satellite** (Esri World Imagery), and **GA Topo** (Geoscience Australia)
- **Relief** hillshade overlay (terrain shading) toggle
- Place search across Australia (OpenStreetMap Nominatim)
- "Locate me" with live GPS tracking and a follow-the-dot mode
- Live centre readout: lat/long **+ MGA/UTM grid reference + terrain elevation**, tap to copy
- Share this location: a link that restores the exact view (centre, zoom, layer)
- Zoom + metric scale controls

**Plan, record & mark**

- **Routes** — tap to add points, drag to move, tap to remove; live distance, ascent/descent, and an elevation profile chart. Save/rename/delete routes and import/export **GPX**.
- **Track recording** — record a live GPS track (distance, time, points), then save it as a route or export GPX
- **Pins** — drop, drag, rename and delete named waypoints; export as GPX. Routes and pins persist on the device.

**Offline & install**

- Offline maps: download the current area and use it with no signal
- Installable to a phone home screen (PWA), with a "new version" reload prompt

## Tech stack

- [Vite](https://vite.dev/) + React + TypeScript
- [MapLibre GL JS](https://maplibre.org/) — open-source map renderer
- [MapTiler Outdoor](https://www.maptiler.com/maps/outdoor/) / [OpenTopoMap](https://opentopomap.org/) / [Esri](https://www.esri.com/) / [Geoscience Australia](https://www.ga.gov.au/) tiles
- [Nominatim](https://nominatim.org/) geocoding, [Open-Meteo](https://open-meteo.com/) elevation
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
    MapView.tsx          # MapLibre map + base style + controls
    SearchBar.tsx        # debounced Nominatim place search
    LocateControl.tsx    # GPS locate + follow mode
    LayerSwitcher.tsx    # base layer + relief toggle
    CoordinateReadout.tsx# lat/long + MGA grid + centre elevation
    RouteTool.tsx        # route drawing, elevation profile, save/GPX
    TrackRecorder.tsx    # live GPS track recording
    PinTool.tsx          # drop/manage waypoints
    OfflinePanel.tsx     # download tiles for offline use
    ShareControl.tsx / UpdatePrompt.tsx / ElevationProfile.tsx
  lib/
    mapStyle.ts          # tile sources, Australia view/bounds, attribution
    geocode.ts           # Nominatim geocoding client
    elevation.ts         # Open-Meteo elevation (profiles + point), retries
    geo.ts / grid.ts     # distance/sampling + MGA/UTM helpers
    gpx.ts               # GPX import/export
    savedRoutes.ts / savedPins.ts  # localStorage persistence
    tiles.ts / urlState.ts / useOnlineStatus.ts
  App.tsx                # app shell
```

## Offline maps

Open the download control (bottom-right), choose a detail level, and download the
current view. Tiles are fetched through the service worker and cached
(`CacheFirst`, cache name `map-tiles`), so any area you've downloaded — or simply
viewed — renders with no connection. Downloads are capped (4,000 tiles) to respect
tile-server fair-use; zoom in or lower the detail for large areas.

## Roadmap

- **Bigger offline regions** — switch to PMTiles archives for whole-state downloads
- **Route following** — off-route alerts and turn-by-turn while navigating a saved route
- **Native app** — reuse this logic with MapLibre React Native, or wrap the PWA
