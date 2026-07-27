import type { StyleSpecification } from 'maplibre-gl'

// NOTE: OpenTopoMap's public tile server (tile.opentopomap.org) is fair-use only
// and is fine for development / light traffic. Before shipping to real users we
// should self-host tiles or switch to a PMTiles archive to respect their policy.
// https://opentopomap.org/about
const OPENTOPO_ATTRIBUTION =
  'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, SRTM | ' +
  'Map style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)'

const SATELLITE_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'

export type BaseLayerId = 'opentopomap' | 'satellite'

export const OPENTOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    opentopomap: {
      type: 'raster',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 17,
      attribution: OPENTOPO_ATTRIBUTION,
    },
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: SATELLITE_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'opentopomap',
      type: 'raster',
      source: 'opentopomap',
    },
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      layout: { visibility: 'none' },
    },
  ],
}

// Roughly frames the whole Australian continent on load.
export const AUSTRALIA_CENTER: [number, number] = [133.7751, -25.2744]
export const AUSTRALIA_INITIAL_ZOOM = 3.6

// Restrict panning to the Australian region (with generous padding) so users
// don't wander off into empty ocean tiles.
export const AUSTRALIA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [105, -45], // south-west
  [160, -8], // north-east
]
