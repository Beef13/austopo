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
  const [elevReloadKey, setElevReloadKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints

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

  // Map interactions while in route mode: tap empty ground to append a point,
  // tap the line to insert one, drag a point to move it, tap a point to delete.
  useEffect(() => {
    const canvas = map.getCanvas()
    const src = () => map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined

    let dragIndex = -1
    let moved = false
    let downXY: maplibregl.Point | null = null
    let live: LngLat[] | null = null

    const setCursor = (c: string) => {
      canvas.style.cursor = c
    }
    const idleCursor = () => setCursor(openRef.current ? 'crosshair' : '')

    const pointIndexAt = (pt: maplibregl.Point): number => {
      const feats = map.queryRenderedFeatures(pt, { layers: [POINT_LAYER] })
      if (feats.length && feats[0].properties) {
        const idx = feats[0].properties.index
        return typeof idx === 'number' ? idx : Number(idx)
      }
      return -1
    }

    // Index of the segment (start vertex) nearest to a screen point.
    const nearestSegment = (pt: maplibregl.Point): number => {
      const wp = waypointsRef.current
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < wp.length - 1; i++) {
        const a = map.project(wp[i])
        const b = map.project(wp[i + 1])
        const abx = b.x - a.x
        const aby = b.y - a.y
        const len2 = abx * abx + aby * aby || 1
        let t = ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2
        t = Math.max(0, Math.min(1, t))
        const dx = a.x + t * abx - pt.x
        const dy = a.y + t * aby - pt.y
        const d = dx * dx + dy * dy
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
      return best
    }

    const onEnterPoint = () => {
      if (openRef.current && dragIndex < 0) setCursor('pointer')
    }
    const onLeavePoint = () => {
      if (dragIndex < 0) idleCursor()
    }

    const onDown = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!openRef.current) return
      if ('touches' in e.originalEvent && e.originalEvent.touches.length > 1) return
      downXY = e.point
      moved = false
      const idx = pointIndexAt(e.point)
      if (idx >= 0) {
        e.preventDefault()
        dragIndex = idx
        live = waypointsRef.current.slice()
        map.dragPan.disable()
        setCursor('grabbing')
      }
    }

    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (downXY && (Math.abs(e.point.x - downXY.x) + Math.abs(e.point.y - downXY.y) > 4)) {
        moved = true
      }
      if (dragIndex < 0 || !live) return
      e.preventDefault()
      live[dragIndex] = [e.lngLat.lng, e.lngLat.lat]
      src()?.setData(routeFeatures(live))
    }

    const onUp = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      // Finish an in-progress point drag.
      if (dragIndex >= 0) {
        const idx = dragIndex
        const committed = live
        dragIndex = -1
        live = null
        map.dragPan.enable()
        idleCursor()
        if (moved && committed) setWaypoints(committed)
        else setWaypoints((prev) => prev.filter((_, i) => i !== idx))
        downXY = null
        return
      }
      if (!openRef.current) {
        downXY = null
        return
      }
      // A tap that didn't move: either insert on the line or append.
      if (!moved) {
        const onLine = map.queryRenderedFeatures(e.point, { layers: [LINE_LAYER] })
        if (onLine.length && waypointsRef.current.length >= 2) {
          const at = nearestSegment(e.point) + 1
          setWaypoints((prev) => {
            const next = prev.slice()
            next.splice(at, 0, [e.lngLat.lng, e.lngLat.lat])
            return next
          })
        } else {
          setWaypoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]])
        }
      }
      downXY = null
    }

    map.on('mouseenter', POINT_LAYER, onEnterPoint)
    map.on('mouseleave', POINT_LAYER, onLeavePoint)
    map.on('mousedown', onDown)
    map.on('touchstart', onDown)
    map.on('mousemove', onMove)
    map.on('touchmove', onMove)
    map.on('mouseup', onUp)
    map.on('touchend', onUp)

    return () => {
      map.off('mouseenter', POINT_LAYER, onEnterPoint)
      map.off('mouseleave', POINT_LAYER, onLeavePoint)
      map.off('mousedown', onDown)
      map.off('touchstart', onDown)
      map.off('mousemove', onMove)
      map.off('touchmove', onMove)
      map.off('mouseup', onUp)
      map.off('touchend', onUp)
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
  }, [waypoints, elevReloadKey])

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
            <span className="route-panel-hint">Tap to add · drag to move · tap a point to remove</span>
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
            {elevError && (
              <div className="route-elev-msg">
                Elevation unavailable
                <button
                  type="button"
                  className="route-elev-retry"
                  onClick={() => setElevReloadKey((k) => k + 1)}
                >
                  Retry
                </button>
              </div>
            )}
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
