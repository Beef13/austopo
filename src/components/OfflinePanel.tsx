import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { hasMaptiler, type BaseLayerId } from '../lib/mapStyle'
import {
  cachedTileCount,
  clearOfflineTiles,
  countTilesForBounds,
  downloadTiles,
  downloadUrls,
  sourceMaxZoom,
  tilesForBounds,
  type Bounds,
  type DownloadProgress,
} from '../lib/tiles'
import {
  countVectorAssets,
  getVectorManifest,
  vectorAssetUrls,
  type VectorManifest,
} from '../lib/offlineVector'

type OfflinePanelProps = {
  map: maplibregl.Map
  layer: BaseLayerId
  open: boolean
  onToggle: () => void
}

const MAX_TILES = 4000
const EST_KB_PER_TILE = 25

function mapBounds(map: maplibregl.Map): Bounds {
  const b = map.getBounds()
  return {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  }
}

function formatSize(tiles: number): string {
  const mb = (tiles * EST_KB_PER_TILE) / 1024
  return mb < 1 ? `${Math.round(mb * 1024)} KB` : `${mb.toFixed(1)} MB`
}

export default function OfflinePanel({ map, layer, open, onToggle }: OfflinePanelProps) {
  const [extraLevels, setExtraLevels] = useState(2)
  const [, setViewTick] = useState(0) // forces recompute as the map moves
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [cachedCount, setCachedCount] = useState(0)
  const [manifest, setManifest] = useState<VectorManifest | null>(null)
  const [manifestState, setManifestState] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  )
  const abortRef = useRef<AbortController | null>(null)

  // The MapTiler "Topo" base is a vector style, which needs its vector tiles,
  // glyphs and sprite cached (not raster PNGs) to work offline.
  const isVectorLayer = layer === 'maptiler' && hasMaptiler
  const useVector = isVectorLayer && manifest !== null

  const refreshCached = useCallback(() => {
    cachedTileCount().then(setCachedCount)
  }, [])

  useEffect(() => {
    if (!open) return
    refreshCached()
    const bump = () => setViewTick((t) => t + 1)
    map.on('moveend', bump)
    return () => {
      map.off('moveend', bump)
    }
  }, [open, map, refreshCached])

  // Load the vector manifest (style.json + source TileJSONs) when needed. If it
  // fails (e.g. offline), we fall back to downloading raster MapTiler tiles.
  useEffect(() => {
    if (!open || !isVectorLayer || manifest || manifestState !== 'idle') return
    setManifestState('loading')
    getVectorManifest()
      .then((m) => {
        setManifest(m)
        setManifestState('idle')
      })
      .catch(() => setManifestState('error'))
  }, [open, isVectorLayer, manifest, manifestState])

  const minZoom = Math.floor(map.getZoom())
  const vectorMaxZoom = manifest
    ? Math.max(...manifest.sources.map((s) => s.maxzoom))
    : 15
  const maxZoom = Math.min(
    minZoom + extraLevels,
    useVector ? vectorMaxZoom : sourceMaxZoom(layer),
  )
  const bounds = mapBounds(map)
  const estimate = useVector
    ? countVectorAssets(manifest, bounds, minZoom, maxZoom)
    : countTilesForBounds(bounds, minZoom, maxZoom)
  const tooLarge = estimate > MAX_TILES
  const preparing = isVectorLayer && manifestState === 'loading' && !manifest
  const downloading = progress !== null

  const start = async () => {
    if (tooLarge || downloading || preparing) return
    const controller = new AbortController()
    abortRef.current = controller
    const opts = { signal: controller.signal, onProgress: setProgress }
    if (useVector) {
      const urls = vectorAssetUrls(manifest, bounds, minZoom, maxZoom)
      setProgress({ done: 0, total: urls.length, failed: 0 })
      await downloadUrls(urls, opts)
    } else {
      const tiles = tilesForBounds(bounds, minZoom, maxZoom)
      setProgress({ done: 0, total: tiles.length, failed: 0 })
      await downloadTiles(layer, tiles, opts)
    }
    abortRef.current = null
    setProgress(null)
    refreshCached()
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setProgress(null)
  }

  const clear = async () => {
    await clearOfflineTiles()
    refreshCached()
  }

  return (
    <div className="offline">
      <button
        type="button"
        className={`offline-btn${open ? ' is-open' : ''}`}
        onClick={onToggle}
        title="Offline maps"
        aria-label="Offline maps"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1ZM5 19a1 1 0 0 1 0-2h14a1 1 0 0 1 0 2H5Z"
          />
        </svg>
      </button>

      <div
        className={`offline-panel${open ? ' is-open' : ' is-closed'}`}
        role="dialog"
        aria-label="Download maps for offline use"
        aria-hidden={!open}
      >
          <div className="offline-panel-title">Download this area</div>
          <p className="offline-panel-hint">
            Saves the current {layer === 'satellite' ? 'satellite' : 'topo'} view for offline use.
          </p>

          {preparing && (
            <p className="offline-panel-hint">Preparing map data&hellip;</p>
          )}
          {isVectorLayer && manifestState === 'error' && (
            <p className="offline-warning">
              Couldn't prepare vector data (you may be offline). Basic tiles will
              be saved instead.
            </p>
          )}

          <label className="offline-field">
            <span>Detail (extra zoom levels): {extraLevels}</span>
            <input
              type="range"
              min={0}
              max={4}
              value={extraLevels}
              disabled={downloading}
              onChange={(e) => setExtraLevels(Number(e.target.value))}
            />
          </label>

          <div className="offline-stats">
            <span>Zoom {minZoom}&ndash;{maxZoom}</span>
            <span>
              ~{estimate.toLocaleString()} {useVector ? 'items' : 'tiles'} &middot; ~
              {formatSize(estimate)}
            </span>
          </div>

          {tooLarge && !downloading && (
            <p className="offline-warning">
              Too large ({estimate.toLocaleString()} tiles). Zoom in or lower the detail (max {MAX_TILES.toLocaleString()}).
            </p>
          )}

          {downloading ? (
            <>
              <div className="offline-progress">
                <div
                  className="offline-progress-bar"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="offline-progress-text">
                {progress.done} / {progress.total}
                {progress.failed > 0 && ` (${progress.failed} failed)`}
              </div>
              <button type="button" className="offline-action offline-cancel" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="offline-action offline-download"
              onClick={start}
              disabled={tooLarge || preparing}
            >
              {preparing ? 'Preparing\u2026' : 'Download'}
            </button>
          )}

          <div className="offline-storage">
            <span>{cachedCount.toLocaleString()} items stored</span>
            {cachedCount > 0 && (
              <button type="button" className="offline-clear" onClick={clear} disabled={downloading}>
                Clear
              </button>
            )}
          </div>
      </div>
    </div>
  )
}
