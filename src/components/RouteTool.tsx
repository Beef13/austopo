import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { formatDistance, formatElevation, pathLength, type LngLat } from '../lib/geo'
import { fetchElevationProfile, type ElevationProfileData } from '../lib/elevation'
import { downloadGpx, parseGpx } from '../lib/gpx'
import ElevationProfile from './ElevationProfile'

type RouteToolProps = {
  map: maplibregl.Map
}

const SOURCE_ID = 'route'
const LINE_LAYER = 'route-line'
const POINT_LAYER = 'route-points'

function routeFeatures(waypoints: LngLat[]): FeatureCollection {
  const features: Feature[] = []
  if (waypoints.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: waypoints },
      properties: {},
    })
  }
  waypoints.forEach((p, i) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { index: i, kind: i === 0 ? 'start' : i === waypoints.length - 1 ? 'end' : 'mid' },
    })
  })
  return { type: 'FeatureCollection', features }
}

export default function RouteTool({ map }: RouteToolProps) {
  const [open, setOpen] = useState(false)
  const [waypoints, setWaypoints] = useState<LngLat[]>([])
  const [profile, setProfile] = useState<ElevationProfileData | null>(null)
  const [elevLoading, setElevLoading] = useState(false)
  const [elevError, setElevError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  // Create the route source + layers once.
  useEffect(() => {
    const setup = () => {
      if (map.getSource(SOURCE_ID)) return
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: routeFeatures([]),
      })
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#e5322d',
          'line-width': 4,
          'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'match',
            ['get', 'kind'],
            'start', '#2e7d32',
            'end', '#c0392b',
            '#ffffff',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#e5322d',
        },
      })
    }
    setup()
    return () => {
      if (map.getLayer(POINT_LAYER)) map.removeLayer(POINT_LAYER)
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  }, [map])

  // Push waypoint changes to the map source.
  useEffect(() => {
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    src?.setData(routeFeatures(waypoints))
  }, [map, waypoints])

  // Add points by clicking the map while the panel (draw mode) is open.
  useEffect(() => {
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!openRef.current) return
      setWaypoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]])
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  // Crosshair cursor while drawing.
  useEffect(() => {
    map.getCanvas().style.cursor = open ? 'crosshair' : ''
    return () => {
      map.getCanvas().style.cursor = ''
    }
  }, [map, open])

  // Debounced elevation profile fetch.
  useEffect(() => {
    if (waypoints.length < 2) {
      setProfile(null)
      setElevError(false)
      return
    }
    const controller = new AbortController()
    setElevLoading(true)
    setElevError(false)
    const timer = setTimeout(async () => {
      try {
        const data = await fetchElevationProfile(waypoints, controller.signal)
        setProfile(data)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setElevError(true)
      } finally {
        setElevLoading(false)
      }
    }, 700)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [waypoints])

  const distance = pathLength(waypoints)

  const undo = () => setWaypoints((prev) => prev.slice(0, -1))
  const clear = () => setWaypoints([])

  const onImportClick = () => fileInputRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const points = parseGpx(text)
      setWaypoints(points)
      const bounds = points.reduce(
        (b, p) => b.extend(p),
        new maplibregl.LngLatBounds(points[0], points[0]),
      )
      map.fitBounds(bounds, { padding: 60, duration: 800 })
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="route">
      <button
        type="button"
        className={`route-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Plan a route"
        aria-label="Plan a route"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-9 8h6a3 3 0 0 0 3-3V9M6 15V8a3 3 0 0 1 3-3h3"
          />
        </svg>
      </button>

      {open && (
        <div className="route-panel" role="dialog" aria-label="Route planner">
          <div className="route-panel-head">
            <span className="route-panel-title">Route</span>
            <span className="route-panel-hint">Tap the map to add points</span>
          </div>

          <div className="route-stats">
            <div className="route-stat">
              <span className="route-stat-val">{formatDistance(distance)}</span>
              <span className="route-stat-key">distance</span>
            </div>
            <div className="route-stat">
              <span className="route-stat-val">
                {profile ? `+${formatElevation(profile.ascent)}` : '\u2013'}
              </span>
              <span className="route-stat-key">ascent</span>
            </div>
            <div className="route-stat">
              <span className="route-stat-val">
                {profile ? `-${formatElevation(profile.descent)}` : '\u2013'}
              </span>
              <span className="route-stat-key">descent</span>
            </div>
          </div>

          <div className="route-elev">
            {elevLoading && <div className="route-elev-msg">Loading elevation&hellip;</div>}
            {elevError && <div className="route-elev-msg">Elevation unavailable</div>}
            {!elevLoading && !elevError && profile && <ElevationProfile data={profile} />}
            {!elevLoading && !elevError && !profile && waypoints.length < 2 && (
              <div className="route-elev-msg">Add at least 2 points for an elevation profile</div>
            )}
          </div>

          <div className="route-actions">
            <button type="button" onClick={undo} disabled={waypoints.length === 0}>
              Undo
            </button>
            <button type="button" onClick={clear} disabled={waypoints.length === 0}>
              Clear
            </button>
            <button type="button" onClick={onImportClick}>
              Import
            </button>
            <button
              type="button"
              onClick={() => downloadGpx(waypoints)}
              disabled={waypoints.length < 2}
            >
              Export
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            onChange={onFile}
            hidden
          />
        </div>
      )}
    </div>
  )
}
