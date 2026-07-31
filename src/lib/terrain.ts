// Local elevation sampling from the same AWS "terrarium" DEM tiles the map uses
// for hillshade. Decoding tiles ourselves lets us read the elevation under any
// point instantly (no network round-trip), so the readout can update in real
// time while panning — and it keeps working offline since these tiles are
// cached by the service worker.
//
// Terrarium encoding: elevation(m) = (R * 256 + G + B / 256) - 32768.

import type { LngLat } from './geo'

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TILE_SIZE = 256
const MAX_ZOOM = 15

type Tile = { data: Uint8ClampedArray } | 'error'

const cache = new Map<string, Tile>()
const loading = new Map<string, Promise<void>>()

// Pick a sampling zoom: high enough for detail, capped so a single tile covers
// a decent area (fewer loads while panning) and within the DEM's range.
export function sampleZoom(mapZoom: number): number {
  return Math.max(5, Math.min(MAX_ZOOM - 1, Math.round(mapZoom)))
}

function tilePixel(lng: number, lat: number, z: number) {
  const n = 2 ** z
  const xf = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const yf =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const tileX = ((Math.floor(xf) % n) + n) % n
  const tileY = Math.max(0, Math.min(n - 1, Math.floor(yf)))
  const px = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((xf - Math.floor(xf)) * TILE_SIZE)))
  const py = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((yf - Math.floor(yf)) * TILE_SIZE)))
  return { tileX, tileY, px, py }
}

function key(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`
}

function decode(data: Uint8ClampedArray, px: number, py: number): number {
  const i = (py * TILE_SIZE + px) * 4
  return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768
}

// Elevation (m) at a point if the covering tile is already decoded, else null.
export function elevationSync(lng: number, lat: number, z: number): number | null {
  const { tileX, tileY, px, py } = tilePixel(lng, lat, z)
  const tile = cache.get(key(z, tileX, tileY))
  if (!tile || tile === 'error') return null
  return decode(tile.data, px, py)
}

// Ensure the covering tile is fetched + decoded. Resolves when it's ready (or
// failed). Rejects only if DEM sampling is unusable in this environment.
export function ensureTile(lng: number, lat: number, z: number): Promise<void> {
  const { tileX, tileY } = tilePixel(lng, lat, z)
  const k = key(z, tileX, tileY)
  if (cache.has(k)) return Promise.resolve()
  const existing = loading.get(k)
  if (existing) return existing
  const url = TILE_URL.replace('{z}', String(z))
    .replace('{x}', String(tileX))
    .replace('{y}', String(tileY))
  const p = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`DEM ${res.status}`)
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = TILE_SIZE
      canvas.height = TILE_SIZE
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('no 2d context')
      ctx.drawImage(bmp, 0, 0, TILE_SIZE, TILE_SIZE)
      bmp.close?.()
      const img = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
      cache.set(k, { data: img.data })
    } catch {
      cache.set(k, 'error')
    } finally {
      loading.delete(k)
    }
  })()
  loading.set(k, p)
  return p
}

// Elevation (m) for a set of points, sampled from the DEM tiles. Picks the
// highest zoom that keeps the number of tiles bounded (so a long route doesn't
// fetch hundreds), loads every covering tile once, then reads each point. Values
// for tiles that failed to load come back null (the caller fills the gaps). This
// is the reliable, rate-limit-free, offline-capable source behind the elevation
// profile — the same tiles used for the live centre readout, so they always
// agree.
export async function sampleElevations(
  points: LngLat[],
  signal?: AbortSignal,
): Promise<(number | null)[]> {
  if (points.length === 0) return []
  const MAX_TILES = 28
  let z = MAX_ZOOM - 1
  while (z > 6) {
    const tiles = new Set<string>()
    for (const [lng, lat] of points) {
      const { tileX, tileY } = tilePixel(lng, lat, z)
      tiles.add(key(z, tileX, tileY))
      if (tiles.size > MAX_TILES) break
    }
    if (tiles.size <= MAX_TILES) break
    z--
  }
  await Promise.all(points.map(([lng, lat]) => ensureTile(lng, lat, z)))
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return points.map(([lng, lat]) => elevationSync(lng, lat, z))
}
