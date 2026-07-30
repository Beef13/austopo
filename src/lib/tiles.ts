import { maptilerTileUrl, type BaseLayerId } from './mapStyle'

export type TileCoord = { z: number; x: number; y: number }
export type Bounds = { west: number; south: number; east: number; north: number }

const TILE_CACHE_NAME = 'map-tiles'

function lon2tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function lat2tileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  )
}

function clampTile(v: number, z: number): number {
  return Math.max(0, Math.min(2 ** z - 1, v))
}

// Enumerate every tile covering `bounds` for zoom levels minZoom..maxZoom.
export function tilesForBounds(
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): TileCoord[] {
  const tiles: TileCoord[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = clampTile(lon2tileX(bounds.west, z), z)
    const x1 = clampTile(lon2tileX(bounds.east, z), z)
    const y0 = clampTile(lat2tileY(bounds.north, z), z)
    const y1 = clampTile(lat2tileY(bounds.south, z), z)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        tiles.push({ z, x, y })
      }
    }
  }
  return tiles
}

export function countTilesForBounds(
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): number {
  let count = 0
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = clampTile(lon2tileX(bounds.west, z), z)
    const x1 = clampTile(lon2tileX(bounds.east, z), z)
    const y0 = clampTile(lat2tileY(bounds.north, z), z)
    const y1 = clampTile(lat2tileY(bounds.south, z), z)
    count += (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1)
  }
  return count
}

export function tileUrl(layer: BaseLayerId, { z, x, y }: TileCoord): string {
  switch (layer) {
    case 'maptiler':
      return maptilerTileUrl(z, x, y)
    case 'satellite':
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    case 'gatopo':
      return `https://services.ga.gov.au/gis/rest/services/Topographic_Base_Map/MapServer/tile/${z}/${y}/${x}`
    case 'opentopomap':
    default:
      return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`
  }
}

// The maximum zoom each source serves natively.
export function sourceMaxZoom(layer: BaseLayerId): number {
  switch (layer) {
    case 'maptiler':
      return 18
    case 'satellite':
      return 19
    case 'gatopo':
      return 12
    case 'opentopomap':
    default:
      return 17
  }
}

export type DownloadProgress = {
  done: number
  total: number
  failed: number
}

// Downloads all tiles for the given layer/bounds/zoom range. Fetches route
// through the service worker, which caches them (CacheFirst) for offline use.
export async function downloadTiles(
  layer: BaseLayerId,
  tiles: TileCoord[],
  opts: {
    concurrency?: number
    signal?: AbortSignal
    onProgress?: (p: DownloadProgress) => void
  } = {},
): Promise<DownloadProgress> {
  const concurrency = opts.concurrency ?? 6
  const progress: DownloadProgress = { done: 0, total: tiles.length, failed: 0 }
  let index = 0

  const worker = async () => {
    while (index < tiles.length) {
      if (opts.signal?.aborted) return
      const tile = tiles[index++]
      try {
        const res = await fetch(tileUrl(layer, tile), { signal: opts.signal })
        if (!res.ok) progress.failed++
      } catch {
        if (opts.signal?.aborted) return
        progress.failed++
      }
      progress.done++
      opts.onProgress?.({ ...progress })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tiles.length) }, worker),
  )
  return progress
}

// Number of tiles currently stored offline.
export async function cachedTileCount(): Promise<number> {
  if (!('caches' in window)) return 0
  try {
    const cache = await caches.open(TILE_CACHE_NAME)
    const keys = await cache.keys()
    return keys.length
  } catch {
    return 0
  }
}

export async function clearOfflineTiles(): Promise<void> {
  if (!('caches' in window)) return
  await caches.delete(TILE_CACHE_NAME)
}
