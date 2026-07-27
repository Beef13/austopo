import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'

// MapTiler Outdoor is the primary basemap when a key is configured (fast global
// CDN, high-detail topo cartography). Get a free key at https://maptiler.com,
// then set VITE_MAPTILER_KEY (see .env.example). Restrict the key to your
// domains in the MapTiler dashboard since it ships to the browser.
export const MAPTILER_KEY = (
  import.meta.env.VITE_MAPTILER_KEY as string | undefined
)?.trim()
export const hasMaptiler = Boolean(MAPTILER_KEY)

const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">MapTiler</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

// NOTE: OpenTopoMap's public tile server (tile.opentopomap.org) is fair-use only.
// It's kept as a free fallback / alternative layer; MapTiler is preferred for
// production. https://opentopomap.org/about
const OPENTOPO_ATTRIBUTION =
  'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, SRTM | ' +
  'Map style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)'

const SATELLITE_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'

const GA_ATTRIBUTION =
  '&copy; <a href="https://www.ga.gov.au" target="_blank" rel="noreferrer">Geoscience Australia</a> (CC-BY 4.0)'

export type BaseLayerId = 'maptiler' | 'opentopomap' | 'satellite' | 'gatopo'

// Base layers offered in the switcher, in order. MapTiler only appears when a
// key is configured; it then becomes the default "Topo" layer.
export const BASE_LAYER_OPTIONS: { id: BaseLayerId; label: string }[] = [
  ...(hasMaptiler
    ? [{ id: 'maptiler' as const, label: 'Topo' }]
    : []),
  { id: 'opentopomap', label: hasMaptiler ? 'OpenTopo' : 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'gatopo', label: 'GA Topo' },
]

export const BASE_LAYER_IDS = BASE_LAYER_OPTIONS.map((o) => o.id)
export const DEFAULT_BASE_LAYER: BaseLayerId = hasMaptiler ? 'maptiler' : 'opentopomap'

const sources: Record<string, SourceSpecification> = {
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
  gatopo: {
    type: 'raster',
    // ArcGIS cached tiles use /tile/{z}/{y}/{x}. Reliable to zoom 12, so we
    // cap maxzoom and let MapLibre overzoom for closer views.
    tiles: [
      'https://services.ga.gov.au/gis/rest/services/Topographic_Base_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 12,
    attribution: GA_ATTRIBUTION,
  },
  'terrain-dem': {
    type: 'raster-dem',
    tiles: [
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    ],
    encoding: 'terrarium',
    tileSize: 256,
    minzoom: 0,
    maxzoom: 15,
    attribution:
      'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen / AWS Open Data</a>',
  },
}

const baseLayers: LayerSpecification[] = []

if (hasMaptiler) {
  sources.maptiler = {
    type: 'raster',
    // 256px endpoint keeps the standard XYZ tiling the offline downloader
    // assumes, so viewed and downloaded tiles share the same cache keys.
    tiles: [
      `https://api.maptiler.com/maps/outdoor-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
    ],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 20,
    attribution: MAPTILER_ATTRIBUTION,
  }
  baseLayers.push({ id: 'maptiler', type: 'raster', source: 'maptiler' })
}

// The default base layer starts visible; the rest are toggled on via the
// LayerSwitcher (which also re-applies the layer restored from a shared URL).
const rasterBases: BaseLayerId[] = ['opentopomap', 'satellite', 'gatopo']
for (const id of rasterBases) {
  baseLayers.push({
    id,
    type: 'raster',
    source: id,
    layout: { visibility: id === DEFAULT_BASE_LAYER ? 'visible' : 'none' },
  })
}

baseLayers.push({
  id: 'hillshade',
  type: 'hillshade',
  source: 'terrain-dem',
  layout: { visibility: 'none' },
  paint: { 'hillshade-exaggeration': 0.45 },
})

export const OPENTOPO_STYLE: StyleSpecification = {
  version: 8,
  sources,
  layers: baseLayers,
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
