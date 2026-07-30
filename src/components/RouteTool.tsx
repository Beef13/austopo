import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import {
  formatDistance,
  formatElevation,
  pathLength,
  pointAtDistance,
  type LngLat,
} from '../lib/geo'
import { fetchElevationProfile, type ElevationProfileData } from '../lib/elevation'
import { downloadGpx, parseGpx } from '../lib/gpx'
import {
  ACTIVITIES,
  estimateTimeSeconds,
  formatDuration,
  getActivity,
  type ActivityId,
} from '../lib/activity'
import {
  cachedSegment,
  primeReversedSegments,
  snapRoute,
  type SegmentCache,
} from '../lib/routing'
import {
  deleteRoute,
  listRoutes,
  renameRoute,
  saveRoute,
  type SavedRoute,
} from '../lib/savedRoutes'
import ElevationProfile from './ElevationProfile'

type RouteToolProps = {
  map: maplibregl.Map
}

const SOURCE_ID = 'route'
const LINE_LAYER = 'route-line'
const POINT_LAYER = 'route-points'

// The visible line follows `line` (the snapped path when routing is on, or the
// straight anchors otherwise); the draggable circles mark the anchor waypoints.
function routeFeatures(waypoints: LngLat[], line: LngLat[]): FeatureCollection {
  const features: Feature[] = []
  if (line.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
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
  const [snappedLine, setSnappedLine] = useState<LngLat[]>([])
  const [snappedAnchors, setSnappedAnchors] = useState<LngLat[]>([])
  const [snap, setSnap] = useState(true)
  const [activityId, setActivityId] = useState<ActivityId>('hiking')
  const [routing, setRouting] = useState(false)
  const [profile, setProfile] = useState<ElevationProfileData | null>(null)
  const [elevLoading, setElevLoading] = useState(false)
  const [elevError, setElevError] = useState(false)
  const [elevReloadKey, setElevReloadKey] = useState(0)
  const [saved, setSaved] = useState<SavedRoute[]>([])
  const [scrubDist, setScrubDist] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const routeCache = useRef<SegmentCache>(new Map())
  const cursorMarker = useRef<maplibregl.Marker | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints

  const activity = getActivity(activityId)
  // Refs so the (map-only) interaction effect always sees the current snap /
  // profile without needing to re-bind its listeners.
  const snapRef = useRef(snap)
  snapRef.current = snap
  const profileRef = useRef(activity.profile)
  profileRef.current = activity.profile

  // The line to draw / measure / profile: the snapped path when it's ready,
  // otherwise the straight anchors (instant feedback while routing).
  const displayLine = useMemo<LngLat[]>(
    () => (snap && snappedLine.length >= 2 ? snappedLine : waypoints),
    [snap, snappedLine, waypoints],
  )

  // Where to draw the draggable dots: snapped onto the line when routing is
  // active (so they never float off-trail), else at the raw tap positions.
  const displayAnchors = useMemo<LngLat[]>(
    () =>
      snap && snappedAnchors.length === waypoints.length && waypoints.length > 0
        ? snappedAnchors
        : waypoints,
    [snap, snappedAnchors, waypoints],
  )

  // Create the route source + layers once.
  useEffect(() => {
    const setup = () => {
      if (map.getSource(SOURCE_ID)) return
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: routeFeatures([], []),
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

  // Push waypoint / line changes to the map source.
  useEffect(() => {
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    src?.setData(routeFeatures(displayAnchors, displayLine))
  }, [map, displayAnchors, displayLine])

  // Snap anchors to paths (debounced) whenever they change, snap is on, or the
  // activity's routing profile changes. Segments are cached so only the edited
  // parts re-fetch; any failure falls back to a straight line.
  useEffect(() => {
    if (!snap || waypoints.length < 2) {
      setSnappedLine([])
      setSnappedAnchors([])
      setRouting(false)
      return
    }
    const controller = new AbortController()
    setRouting(true)
    const timer = setTimeout(async () => {
      try {
        const result = await snapRoute(
          waypoints,
          activity.profile,
          routeCache.current,
          controller.signal,
        )
        setSnappedLine(result.line)
        setSnappedAnchors(result.anchors)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSnappedLine([])
          setSnappedAnchors([])
        }
      } finally {
        setRouting(false)
      }
    }, 400)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [waypoints, snap, activity.profile])

  // Map interactions while in route mode: tap empty ground to append a point,
  // tap the line to insert one, drag a point to move it, tap a point to delete.
  useEffect(() => {
    const canvas = map.getCanvas()
    const src = () => map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined

    let dragIndex = -1
    let moved = false
    let panned = false
    let downXY: maplibregl.Point | null = null
    let live: LngLat[] | null = null

    // MapLibre fires `dragstart` only when the user actually pans the map, which
    // is a far more reliable "this was a pan, not a tap" signal than tracking
    // pointer movement ourselves (mousemove/touchmove aren't emitted during an
    // active drag-pan). We use it to avoid dropping a marker after panning.
    const onDragStart = () => {
      if (openRef.current && dragIndex < 0) panned = true
    }

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

    // Squared pixel distance from a screen point to a projected line segment.
    const distToSeg = (
      pt: maplibregl.Point,
      a: maplibregl.Point,
      b: maplibregl.Point,
    ): number => {
      const abx = b.x - a.x
      const aby = b.y - a.y
      const len2 = abx * abx + aby * aby || 1
      let t = ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2
      t = Math.max(0, Math.min(1, t))
      const dx = a.x + t * abx - pt.x
      const dy = a.y + t * aby - pt.y
      return dx * dx + dy * dy
    }

    // Which anchor interval a click belongs to, measured against the geometry
    // that's actually drawn (the snapped sub-path when snapping, else the
    // straight segment). Returns the start-anchor index; insert after it.
    const nearestSegment = (pt: maplibregl.Point): number => {
      const wp = waypointsRef.current
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < wp.length - 1; i++) {
        const geom =
          (snapRef.current &&
            cachedSegment(wp[i], wp[i + 1], profileRef.current, routeCache.current)) ||
          [wp[i], wp[i + 1]]
        for (let j = 0; j < geom.length - 1; j++) {
          const d = distToSeg(pt, map.project(geom[j]), map.project(geom[j + 1]))
          if (d < bestDist) {
            bestDist = d
            best = i
          }
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
      panned = false
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
      src()?.setData(routeFeatures(live, live))
    }

    const onUp = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const wasPanned = panned
      panned = false
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
      // A genuine tap (no pan, no drag): either insert on the line or append.
      if (!moved && !wasPanned) {
        // Hit-test the line within a tolerance box (not a single pixel) so a
        // tap slightly off the ~4px line still counts as "on the line".
        const tol = 'touches' in e.originalEvent ? 18 : 12
        const { x, y } = e.point
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [
          [x - tol, y - tol],
          [x + tol, y + tol],
        ]
        const onLine = map.queryRenderedFeatures(box, { layers: [LINE_LAYER] })
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
    map.on('dragstart', onDragStart)
    map.on('mousedown', onDown)
    map.on('touchstart', onDown)
    map.on('mousemove', onMove)
    map.on('touchmove', onMove)
    map.on('mouseup', onUp)
    map.on('touchend', onUp)

    return () => {
      map.off('mouseenter', POINT_LAYER, onEnterPoint)
      map.off('mouseleave', POINT_LAYER, onLeavePoint)
      map.off('dragstart', onDragStart)
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

  // Debounced elevation profile fetch, following the drawn line.
  useEffect(() => {
    if (displayLine.length < 2) {
      setProfile(null)
      setElevError(false)
      return
    }
    const controller = new AbortController()
    setElevLoading(true)
    setElevError(false)
    const timer = setTimeout(async () => {
      try {
        const data = await fetchElevationProfile(displayLine, controller.signal)
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
  }, [displayLine, elevReloadKey])

  // Move a marker along the route to mirror the elevation-chart scrub position.
  useEffect(() => {
    if (!open || scrubDist === null || displayLine.length < 2) {
      cursorMarker.current?.remove()
      cursorMarker.current = null
      return
    }
    const coord = pointAtDistance(displayLine, scrubDist)
    if (!cursorMarker.current) {
      const el = document.createElement('div')
      el.className = 'elev-cursor-marker'
      cursorMarker.current = new maplibregl.Marker({ element: el })
        .setLngLat(coord)
        .addTo(map)
    } else {
      cursorMarker.current.setLngLat(coord)
    }
  }, [open, scrubDist, displayLine, map])

  // Remove the scrub marker on unmount.
  useEffect(
    () => () => {
      cursorMarker.current?.remove()
      cursorMarker.current = null
    },
    [],
  )

  // Refresh the saved-route list whenever the panel is opened.
  useEffect(() => {
    if (open) setSaved(listRoutes())
  }, [open])

  const distance = pathLength(displayLine)
  const estimatedTime = profile
    ? estimateTimeSeconds(distance, profile.ascent, activity)
    : null

  const fitToWaypoints = (points: LngLat[]) => {
    if (points.length < 2) return
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(points[0], points[0]),
    )
    map.fitBounds(bounds, { padding: 60, duration: 800 })
  }

  const undo = () => setWaypoints((prev) => prev.slice(0, -1))
  const clear = () => setWaypoints([])

  const samePoint = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1]

  // Whether the current route is already a closed loop / a there-and-back, so
  // the buttons can act as toggles and show an active state.
  const isClosed =
    waypoints.length >= 3 &&
    samePoint(waypoints[0], waypoints[waypoints.length - 1])
  const isOutAndBack = (() => {
    const n = waypoints.length
    if (n < 3 || n % 2 === 0) return false
    for (let i = 0; i < n >> 1; i++) {
      if (!samePoint(waypoints[i], waypoints[n - 1 - i])) return false
    }
    return true
  })()

  // Walk the route in the opposite direction. Reuse the existing snapped
  // geometry (reversed) so the drawn line keeps its shape.
  const reverse = () =>
    setWaypoints((prev) => {
      primeReversedSegments(prev, profileRef.current, routeCache.current)
      return prev.slice().reverse()
    })

  // Toggle there-and-back: A-B-C <-> A-B-C-B-A. The return leg reuses the
  // outbound line reversed, so applying it doesn't reshape the path.
  const outAndBack = () =>
    setWaypoints((prev) => {
      if (prev.length < 2) return prev
      if (isOutAndBack) return prev.slice(0, Math.ceil(prev.length / 2))
      primeReversedSegments(prev, profileRef.current, routeCache.current)
      return [...prev, ...prev.slice(0, -1).reverse()]
    })

  // Toggle a closed loop: append the start, or drop it again.
  const closeLoop = () =>
    setWaypoints((prev) => {
      if (isClosed) return prev.slice(0, -1)
      if (prev.length < 3) return prev
      return [...prev, prev[0]]
    })

  const onSave = () => {
    if (waypoints.length < 2) return
    const suggested = `Route ${formatDistance(distance)}`
    const name = window.prompt('Name this route', suggested)
    if (name === null) return
    setSaved(saveRoute(name, waypoints))
  }

  const onLoad = (route: SavedRoute) => {
    setWaypoints(route.waypoints)
    fitToWaypoints(route.waypoints)
  }

  const onRename = (route: SavedRoute) => {
    const name = window.prompt('Rename route', route.name)
    if (name === null) return
    setSaved(renameRoute(route.id, name))
  }

  const onDelete = (route: SavedRoute) => {
    if (!window.confirm(`Delete "${route.name}"?`)) return
    setSaved(deleteRoute(route.id))
  }

  const onImportClick = () => fileInputRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const points = parseGpx(text)
      // Imported tracks are already dense paths; show them as-is rather than
      // re-snapping hundreds of points.
      setSnap(false)
      setWaypoints(points)
      fitToWaypoints(points)
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

          <div className="route-controls">
            <label className="route-activity">
              <span className="route-control-key">Activity</span>
              <select
                value={activityId}
                onChange={(e) => setActivityId(e.target.value as ActivityId)}
              >
                {ACTIVITIES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="route-snap" title="Follow tracks and trails between points">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              <span>
                Snap to paths
                {snap && routing && <span className="route-snap-busy"> · routing…</span>}
              </span>
            </label>
          </div>

          <div className="route-stats">
            <div className="route-stat">
              <span className="route-stat-val">{formatDistance(distance)}</span>
              <span className="route-stat-key">distance</span>
            </div>
            <div className="route-stat">
              <span className="route-stat-val">
                {estimatedTime !== null ? formatDuration(estimatedTime) : '\u2013'}
              </span>
              <span className="route-stat-key">est. time</span>
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
            {!elevLoading && !elevError && profile && (
              <ElevationProfile data={profile} onScrub={setScrubDist} />
            )}
            {!elevLoading && !elevError && !profile && waypoints.length < 2 && (
              <div className="route-elev-msg">Add at least 2 points for an elevation profile</div>
            )}
          </div>

          <div className="route-actions route-shape">
            <button
              type="button"
              onClick={reverse}
              disabled={waypoints.length < 2}
              title="Reverse the route direction"
            >
              Reverse
            </button>
            <button
              type="button"
              className={isOutAndBack ? 'is-active' : ''}
              aria-pressed={isOutAndBack}
              onClick={outAndBack}
              disabled={waypoints.length < 2}
              title={
                isOutAndBack
                  ? 'Remove the return leg (back to one-way)'
                  : 'Retrace the route back to the start (there and back)'
              }
            >
              Out &amp; back
            </button>
            <button
              type="button"
              className={isClosed ? 'is-active' : ''}
              aria-pressed={isClosed}
              onClick={closeLoop}
              disabled={!isClosed && waypoints.length < 3}
              title={isClosed ? 'Open the loop again' : 'Return to the start to form a loop'}
            >
              Close loop
            </button>
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
              onClick={() => downloadGpx(displayLine)}
              disabled={displayLine.length < 2}
            >
              Export
            </button>
          </div>

          <button
            type="button"
            className="route-save"
            onClick={onSave}
            disabled={waypoints.length < 2}
          >
            Save route
          </button>

          {saved.length > 0 && (
            <div className="route-saved">
              <div className="route-saved-title">Saved routes</div>
              <ul className="route-saved-list">
                {saved.map((r) => (
                  <li key={r.id} className="route-saved-item">
                    <button
                      type="button"
                      className="route-saved-load"
                      onClick={() => onLoad(r)}
                      title="Load this route"
                    >
                      <span className="route-saved-name">{r.name}</span>
                      <span className="route-saved-meta">
                        {r.waypoints.length} pts
                      </span>
                    </button>
                    <button
                      type="button"
                      className="route-saved-icon"
                      onClick={() => onRename(r)}
                      title="Rename"
                      aria-label={`Rename ${r.name}`}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="route-saved-icon"
                      onClick={() => onDelete(r)}
                      title="Delete"
                      aria-label={`Delete ${r.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
