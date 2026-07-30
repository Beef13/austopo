import { MAPTILER_STYLE_URL, hasMaptiler } from './mapStyle'
import {
  countTilesForBounds,
  tilesForBounds,
  type Bounds,
} from './tiles'

// Offline support for the MapTiler VECTOR "Topo" base. Unlike a raster layer
// (one PNG per tile), a vector style needs several things cached to render
// offline: the style.json, each source's TileJSON + vector/terrain tiles, the
// glyph (font) ranges the labels use, and the sprite (icon) sheet. We enumerate
// all of those URLs and fetch them through the service worker (CacheFirst), so
// they land in the same `map-tiles` cache as raster tiles.

// Latin place names in Australia fall within these Unicode glyph ranges.
const GLYPH_RANGES = ['0-255', '256-511']

type ManifestSource = { template: string; minzoom: number; maxzoom: number }

export type VectorManifest = {
  styleUrl: string
  // Fixed (bounds-independent) assets: style.json, TileJSONs, sprite, glyphs.
  fixedUrls: string[]
  // Tiled sources to enumerate per download region.
  sources: ManifestSource[]
}

type RawSource = {
  type?: string
  url?: string
  tiles?: string[]
  minzoom?: number
  maxzoom?: number
}

type RawStyle = {
  glyphs?: string
  sprite?: string
  sources?: Record<string, RawSource>
  layers?: { layout?: { 'text-font'?: unknown } }[]
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return (await res.json()) as T
}

// MapLibre replaces {fontstack} with the raw stack, and the browser then
// normalises spaces to %20 while leaving commas intact. Encoding each font name
// and re-joining with commas reproduces that exact URL so our cached entry
// matches the one MapLibre later requests.
function encodeFontstack(stack: string): string {
  return stack
    .split(',')
    .map((s) => encodeURIComponent(s.trim()))
    .join(',')
}

let manifestPromise: Promise<VectorManifest> | null = null

// Builds (and memoises) the manifest of everything needed to render the vector
// base offline. Requires network; call while online before a trip.
export function getVectorManifest(signal?: AbortSignal): Promise<VectorManifest> {
  if (!hasMaptiler) return Promise.reject(new Error('MapTiler not configured'))
  if (!manifestPromise) {
    manifestPromise = buildManifest(signal).catch((err) => {
      // Don't cache a failed attempt.
      manifestPromise = null
      throw err
    })
  }
  return manifestPromise
}

async function buildManifest(signal?: AbortSignal): Promise<VectorManifest> {
  const style = await fetchJson<RawStyle>(MAPTILER_STYLE_URL, signal)
  const fixedUrls = new Set<string>([MAPTILER_STYLE_URL])
  const sources: ManifestSource[] = []

  for (const src of Object.values(style.sources ?? {})) {
    const tiled =
      src.type === 'vector' ||
      src.type === 'raster' ||
      src.type === 'raster-dem'
    if (!tiled) continue

    let template: string | undefined
    let minzoom = src.minzoom ?? 0
    let maxzoom = src.maxzoom ?? 14

    if (Array.isArray(src.tiles) && src.tiles.length) {
      template = src.tiles[0]
    } else if (src.url) {
      fixedUrls.add(src.url)
      const tj = await fetchJson<RawSource>(src.url, signal)
      template = tj.tiles?.[0]
      if (typeof tj.minzoom === 'number') minzoom = tj.minzoom
      if (typeof tj.maxzoom === 'number') maxzoom = tj.maxzoom
    }
    if (template) sources.push({ template, minzoom, maxzoom })
  }

  // Glyph ranges for every fontstack referenced by the style's labels.
  if (typeof style.glyphs === 'string') {
    const stacks = new Set<string>()
    for (const layer of style.layers ?? []) {
      const font = layer.layout?.['text-font']
      if (Array.isArray(font) && font.every((f) => typeof f === 'string')) {
        stacks.add((font as string[]).join(','))
      }
    }
    for (const stack of stacks) {
      for (const range of GLYPH_RANGES) {
        fixedUrls.add(
          style.glyphs
            .replace('{fontstack}', encodeFontstack(stack))
            .replace('{range}', range),
        )
      }
    }
  }

  // Sprite sheet (icon atlas): json + png at 1x and 2x so it renders on any DPI.
  if (typeof style.sprite === 'string') {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
      fixedUrls.add(style.sprite + suffix)
    }
  }

  return { styleUrl: MAPTILER_STYLE_URL, fixedUrls: [...fixedUrls], sources }
}

// Clamp a display zoom into a source's available range (sources with a lower
// maxzoom are overzoomed by MapLibre, so we cache their deepest tiles).
function clamp(z: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, z))
}

// Total number of URLs a download for this region will fetch (for the UI's
// size estimate).
export function countVectorAssets(
  manifest: VectorManifest,
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): number {
  let count = manifest.fixedUrls.length
  for (const s of manifest.sources) {
    const lo = clamp(minZoom, s.minzoom, s.maxzoom)
    const hi = clamp(maxZoom, s.minzoom, s.maxzoom)
    count += countTilesForBounds(bounds, lo, hi)
  }
  return count
}

// Every URL needed to render this region offline.
export function vectorAssetUrls(
  manifest: VectorManifest,
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): string[] {
  const urls = new Set<string>(manifest.fixedUrls)
  for (const s of manifest.sources) {
    const lo = clamp(minZoom, s.minzoom, s.maxzoom)
    const hi = clamp(maxZoom, s.minzoom, s.maxzoom)
    for (const t of tilesForBounds(bounds, lo, hi)) {
      urls.add(
        s.template
          .replace('{z}', String(t.z))
          .replace('{x}', String(t.x))
          .replace('{y}', String(t.y)),
      )
    }
  }
  return [...urls]
}
