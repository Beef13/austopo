import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'

// MapTiler is the primary basemap when a key is configured (fast global CDN,
// high-detail topo cartography). Get a free key at https://maptiler.com,
// then set VITE_MAPTILER_KEY (see .env.example). Restrict the key to your
// domains in the MapTiler dashboard since it ships to the browser.
export const MAPTILER_KEY = (
  import.meta.env.VITE_MAPTILER_KEY as string | undefined
)?.trim()
export const hasMaptiler = Boolean(MAPTILER_KEY)

// We render MapTiler's "Topo" style as a VECTOR style (fetched at runtime) so
// it stays crisp at every zoom on any screen and lets us tune cartography,
// rather than pre-rendered raster tiles which look soft when upscaled. If the
// vector style can't be fetched (offline first-run, quota, provider outage) we
// fall back to the raster version of the same style so the layer still works.
export const MAPTILER_STYLE_ID = 'topo-v2'
export const MAPTILER_STYLE_URL = `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${MAPTILER_KEY}`

// Raster tile URL for the same style — used as the vector fallback and by the
// offline region downloader.
export function maptilerTileUrl(
  z: number | string,
  x: number | string,
  y: number | string,
): string {
  return `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/256/${z}/${x}/${y}.png?key=${MAPTILER_KEY}`
}

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
  ...(hasMaptiler ? [{ id: 'maptiler' as const, label: 'Topo' }] : []),
  { id: 'opentopomap', label: hasMaptiler ? 'OpenTopo' : 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'gatopo', label: 'GA Topo' },
]

export const BASE_LAYER_IDS = BASE_LAYER_OPTIONS.map((o) => o.id)
export const DEFAULT_BASE_LAYER: BaseLayerId = hasMaptiler
  ? 'maptiler'
  : 'opentopomap'

// Marker we attach to every layer belonging to a base map so the LayerSwitcher
// can show/hide a whole base (e.g. MapTiler's ~100 vector layers) as a group,
// while remembering each layer's original visibility (`ov`).
export type BaseLayerMeta = { base: BaseLayerId; ov: 'visible' | 'none' }

function rasterSources(): Record<string, SourceSpecification> {
  return {
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
}

// The raster base layers (everything except MapTiler). Each is visible only when
// it's the default; the LayerSwitcher toggles the rest.
function rasterBaseLayers(): LayerSpecification[] {
  const ids: BaseLayerId[] = ['opentopomap', 'satellite', 'gatopo']
  return ids.map((id) => ({
    id,
    type: 'raster',
    source: id,
    metadata: { base: id, ov: 'visible' } satisfies BaseLayerMeta,
    layout: { visibility: id === DEFAULT_BASE_LAYER ? 'visible' : 'none' },
  }))
}

const hillshadeLayer: LayerSpecification = {
  id: 'hillshade',
  type: 'hillshade',
  source: 'terrain-dem',
  layout: { visibility: 'none' },
  paint: { 'hillshade-exaggeration': 0.45 },
}

// Raster fallback for the MapTiler base (used if the vector style won't load).
function maptilerRasterLayer(): LayerSpecification {
  return {
    id: 'maptiler',
    type: 'raster',
    source: 'maptiler',
    metadata: { base: 'maptiler', ov: 'visible' } satisfies BaseLayerMeta,
    layout: { visibility: DEFAULT_BASE_LAYER === 'maptiler' ? 'visible' : 'none' },
  }
}

// Synchronous, raster-only style with no MapTiler layers. Used as the ultimate
// fallback if buildStyle() itself fails.
export const OPENTOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: rasterSources(),
  layers: [...rasterBaseLayers(), hillshadeLayer],
}

// Builds the full map style. When a MapTiler key is present we fetch MapTiler's
// vector "Topo" style and splice its sources/layers in at the bottom (tagged so
// the switcher can toggle them as one base), falling back to raster MapTiler if
// the fetch fails. Overlays (routes, pins, tracks) are added later by their
// components and therefore sit above all base layers.
export async function buildStyle(): Promise<StyleSpecification> {
  const sources = rasterSources()
  const baseGroup: LayerSpecification[] = []
  let glyphs: string | undefined
  let sprite: string | undefined

  if (hasMaptiler) {
    try {
      const res = await fetch(MAPTILER_STYLE_URL)
      if (!res.ok) throw new Error(`MapTiler style ${res.status}`)
      const mt = (await res.json()) as StyleSpecification
      glyphs = mt.glyphs
      sprite = typeof mt.sprite === 'string' ? mt.sprite : undefined
      for (const [id, src] of Object.entries(mt.sources ?? {})) {
        sources[id] = src as SourceSpecification
      }
      const visible = DEFAULT_BASE_LAYER === 'maptiler'
      for (const layer of mt.layers ?? []) {
        const ov: 'visible' | 'none' =
          (layer.layout as { visibility?: 'visible' | 'none' } | undefined)
            ?.visibility === 'none'
            ? 'none'
            : 'visible'
        baseGroup.push({
          ...layer,
          metadata: {
            ...((layer.metadata as object | undefined) ?? {}),
            base: 'maptiler',
            ov,
          },
          layout: {
            ...(layer.layout as object | undefined),
            visibility: visible ? ov : 'none',
          },
        } as LayerSpecification)
      }
    } catch (err) {
      // Vector style unavailable — fall back to raster MapTiler tiles so the
      // "Topo" layer still renders.
      console.warn('MapTiler vector style unavailable, using raster:', err)
      sources.maptiler = {
        type: 'raster',
        tiles: [maptilerTileUrl('{z}', '{x}', '{y}')],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 20,
        attribution: MAPTILER_ATTRIBUTION,
      }
      baseGroup.push(maptilerRasterLayer())
    }
  }

  const style: StyleSpecification = {
    version: 8,
    sources,
    layers: [...baseGroup, ...rasterBaseLayers(), hillshadeLayer],
  }
  if (glyphs) style.glyphs = glyphs
  if (sprite) style.sprite = sprite
  return style
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
