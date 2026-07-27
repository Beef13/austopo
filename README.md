# AusTopo

A fast, mobile-friendly web app for browsing **detailed topographic maps of Australia** — an "OS Maps"-style experience built on open data. Pan and zoom OpenTopoMap terrain, jump to your GPS location, and search for any place in Australia.

Built as an installable **PWA** so it can grow into offline map downloads and, eventually, a native app.

## Features

- Full-screen topographic map (OpenTopoMap style) framed on Australia
- "Locate me" with live GPS tracking and a follow-the-dot mode
- Place search across Australia (OpenStreetMap Nominatim)
- Zoom + metric scale controls
- Installable to a phone home screen (PWA)

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

## Data sources & attribution

This app relies on openly licensed data. Attribution is shown on the map and is **required** by the licenses:

- **Map tiles / style:** © [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA)
- **Map data:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, and SRTM elevation
- **Search:** [OpenStreetMap Nominatim](https://nominatim.org/)

## Usage-policy notes (important before going live)

- **OpenTopoMap tiles** — the public tile server (`tile.opentopomap.org`) is **fair-use only**. Fine for development and light traffic, but before shipping to real users you should self-host tiles or serve a [PMTiles](https://protomaps.com/) archive. See `src/lib/mapStyle.ts`.
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

## Roadmap

- **Offline maps** — download regions as PMTiles for offline use (the "killer feature")
- **Routes** — draw/save routes with distance and elevation profiles
- **Native app** — reuse this logic with MapLibre React Native, or wrap the PWA
