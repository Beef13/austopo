import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import {
  formatDistance,
  formatElevation,
  haversine,
  nearestOnPath,
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

const ROUTE_COLOR = '#e5322d'
const ROUTE_CLEAR = 'rgba(229,50,45,0)'

// A `line-gradient` expression that shows the route solid up to `p` (0..1 along
// the line) and transparent after. Animating `p` via setPaintProperty draws the
// line on the GPU — smooth, and far cheaper than re-feeding geometry with
// setData every frame (which round-trips through the tiling worker and stutters).
type GradientExpr = maplibregl.ExpressionSpecification
function revealGradient(p: number): GradientExpr {
  const a = Math.max(0.0001, Math.min(1, p))
  if (a >= 0.999) {
    return ['interpolate', ['linear'], ['line-progress'], 0, ROUTE_COLOR, 1, ROUTE_COLOR]
  }
  const b = Math.min(a + 0.0001, 1)
  if (b >= 1) {
    return [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      ROUTE_COLOR,
      a,
      ROUTE_COLOR,
      1,
      ROUTE_CLEAR,
    ]
  }
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    ROUTE_COLOR,
    a,
    ROUTE_COLOR,
    b,
    ROUTE_CLEAR,
    1,
    ROUTE_CLEAR,
  ]
}

// How far off the line (m) counts as "off route", and how close to the end (m)
// counts as arrived.
const OFF_ROUTE_M = 40
const ARRIVE_M = 25

type FollowProgress = {
  remaining: number
  offset: number
  eta: number | null
  arrived: boolean
}

function locationMarkerEl(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'user-location-marker'
  el.innerHTML =
    '<span class="user-location-pulse"></span><span class="user-location-dot"></span>'
  return el
}

// How many leading vertices two polylines share (within a few metres). Used to
// tell an append (draw the new tail) from an edit (just redraw).
function commonPrefixLen(a: LngLat[], b: LngLat[]): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && haversine(a[i], b[i]) < 2) i++
  return i
}

// A numbered waypoint badge. It's a pointer-events:none overlay so it never
// intercepts the map interactions that drive drag / insert / delete.
function waypointBadgeEl(label: string, kind: string): HTMLElement {
  const el = document.createElement('div')
  el.className = `route-wp-badge route-wp-${kind}`
  el.textContent = label
  return el
}

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
  // The waypoints the current snappedLine was built from, so we only project a
  // waypoint onto the line once the line actually covers it.
  const [snappedFor, setSnappedFor] = useState<LngLat[]>([])
  const [snap, setSnap] = useState(true)
  const [activityId, setActivityId] = useState<ActivityId>('hiking')
  const [routing, setRouting] = useState(false)
  const [profile, setProfile] = useState<ElevationProfileData | null>(null)
  const [elevLoading, setElevLoading] = useState(false)
  const [elevError, setElevError] = useState(false)
  const [elevReloadKey, setElevReloadKey] = useState(0)
  const [saved, setSaved] = useState<SavedRoute[]>([])
  const [scrubDist, setScrubDist] = useState<number | null>(null)
  const [following, setFollowing] = useState(false)
  const [progress, setProgress] = useState<FollowProgress | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const routeCache = useRef<SegmentCache>(new Map())
  const cursorMarker = useRef<maplibregl.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const gpsMarkerRef = useRef<maplibregl.Marker | null>(null)
  const progressMarkerRef = useRef<maplibregl.Marker | null>(null)
  const wpMarkersRef = useRef<maplibregl.Marker[]>([])
  // The line geometry currently on the map, the in-flight rAF id, and the reveal
  // animation's current progress (0..1) plus the total length that fraction is
  // measured against — so a reveal can continue seamlessly when the geometry it's
  // drawing changes mid-flight (e.g. the straight stub settling onto the snapped
  // path).
  const drawnLineRef = useRef<LngLat[]>([])
  const drawAnimRef = useRef<number | null>(null)
  const progRef = useRef(1)
  const animTotalRef = useRef(0)
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

  // The line to draw / measure / profile. Snapping off: the straight waypoints.
  // Snapping on: the snapped path once it's ready (empty while the first segment
  // is still routing). We deliberately don't show a straight stub to the newest
  // point first — the line just draws in as the real snapped path when it lands.
  const displayLine = useMemo<LngLat[]>(
    () => (snap ? snappedLine : waypoints),
    [snap, snappedLine, waypoints],
  )

  // Where to draw the draggable dots / numbered badges: they must always sit on
  // the line the user sees. With snapping off, the anchors are the line's own
  // vertices. With snapping on, project each raw waypoint onto the drawn line so
  // a badge can never float off-trail — this is robust to partially-snapped
  // routes and to segments that fell back to a straight line (e.g. an off-road
  // tap the router couldn't reach), unlike trusting the snapped endpoints alone.
  const displayAnchors = useMemo<LngLat[]>(() => {
    if (!snap || waypoints.length === 0) return waypoints
    if (snappedLine.length < 2) return waypoints
    // Only project waypoints the current snapped line covers. A just-added or
    // just-moved point isn't on the (still-stale) line yet, so show it at the
    // tap location until the fresh snap arrives — otherwise it would flash onto
    // the old path and then jump to the click.
    const known = new Set(snappedFor.map((p) => `${p[0]},${p[1]}`))
    return waypoints.map((w) =>
      known.has(`${w[0]},${w[1]}`) ? nearestOnPath(snappedLine, w).point : w,
    )
  }, [snap, snappedLine, snappedFor, waypoints])

  // Create the route source + layers once.
  useEffect(() => {
    const setup = () => {
      if (map.getSource(SOURCE_ID)) return
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        // lineMetrics lets the line layer use `line-progress` for the draw-in
        // gradient animation.
        lineMetrics: true,
        data: routeFeatures([], []),
      })
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-gradient': revealGradient(1),
          'line-width': 4,
          'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        // Invisible hit-target: the visible waypoint is a numbered DOM badge
        // (see the badge sync effect). Sized to match the badge so taps near
        // its edge still register for drag/delete, and queryable even at zero
        // opacity since queries are geometry-based.
        paint: {
          'circle-radius': 11,
          'circle-color': '#000000',
          'circle-opacity': 0,
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

  // Push line + hit-target geometry to the source and drive the draw-in reveal.
  useEffect(() => {
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    if (import.meta.env.DEV) {
      ;(window as unknown as { __routeLine?: LngLat[] }).__routeLine = displayLine
    }

    const prev = drawnLineRef.current
    const next = displayLine
    const total = pathLength(next)

    const setGradient = (p: number) => {
      progRef.current = p
      if (map.getLayer(LINE_LAYER)) {
        map.setPaintProperty(LINE_LAYER, 'line-gradient', revealGradient(p))
      }
      if (import.meta.env.DEV) {
        ;(window as unknown as { __drawProgress?: number }).__drawProgress = p
      }
    }
    const stop = () => {
      if (drawAnimRef.current !== null) {
        cancelAnimationFrame(drawAnimRef.current)
        drawAnimRef.current = null
      }
    }
    const finish = () => {
      stop()
      drawnLineRef.current = next
      animTotalRef.current = total
      setGradient(1)
    }

    // Always keep the source's geometry + invisible hit-targets current.
    src.setData(routeFeatures(displayAnchors, next))

    const animating = drawAnimRef.current !== null
    // Vertices shared at the front stay put; the tail is what changed.
    const k = commonPrefixLen(prev, next)
    const identical = prev.length === next.length && k === next.length

    // Nothing about the line changed (e.g. only the badges/anchors moved): leave
    // an in-flight reveal alone, otherwise make sure the line is fully shown.
    if (identical) {
      if (!animating) setGradient(1)
      return
    }

    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (reduceMotion || total < 1) {
      finish()
      return
    }

    const sharedLen = k > 0 ? pathLength(next.slice(0, k)) : 0
    // Reshapes that aren't a tail edit (reverse, activity change, mid-point drag)
    // share little of the front — snap those straight to full, don't draw them.
    const prevLen = pathLength(prev)
    const tailEdit = prev.length < 2 || sharedLen >= Math.min(prevLen, total) * 0.5
    if (!tailEdit) {
      finish()
      return
    }

    // Where to start the reveal from (metres along the new line). If a reveal is
    // already running, continue from however far it had drawn (converted from the
    // old total) so a straight stub settling onto the snapped path keeps drawing
    // instead of restarting; otherwise start at the junction with the unchanged
    // front.
    const drawnAbs = animating ? progRef.current * animTotalRef.current : 0
    const fromAbs = Math.min(total, Math.max(sharedLen, drawnAbs))
    if (total - fromAbs < 1) {
      finish()
      return
    }
    const startFrac = fromAbs / total

    stop()
    drawnLineRef.current = next
    animTotalRef.current = total
    setGradient(startFrac)

    // Draw pace: ~0.6 ms per metre, clamped 67–300 ms — snappy, so the line
    // keeps up with quick point placement.
    const duration = Math.min(300, Math.max(67, (total - fromAbs) * 0.6))
    const t0 = performance.now()
    if (import.meta.env.DEV) {
      ;(window as unknown as { __drawFrames?: number }).__drawFrames = 0
    }
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - f, 3)
      setGradient(startFrac + (1 - startFrac) * eased)
      if (import.meta.env.DEV) {
        const w = window as unknown as { __drawFrames?: number }
        w.__drawFrames = (w.__drawFrames ?? 0) + 1
      }
      if (f < 1) drawAnimRef.current = requestAnimationFrame(step)
      else {
        drawAnimRef.current = null
        setGradient(1)
      }
    }
    drawAnimRef.current = requestAnimationFrame(step)
  }, [map, displayAnchors, displayLine])

  // Stop any in-flight draw animation on unmount.
  useEffect(
    () => () => {
      if (drawAnimRef.current !== null) cancelAnimationFrame(drawAnimRef.current)
    },
    [],
  )

  // Keep the numbered badge markers in sync with the anchors.
  useEffect(() => {
    const markers = wpMarkersRef.current
    const anchors = displayAnchors
    anchors.forEach((p, i) => {
      const kind = i === 0 ? 'start' : i === anchors.length - 1 ? 'end' : 'mid'
      const label = String(i + 1)
      let m = markers[i]
      if (!m) {
        m = new maplibregl.Marker({ element: waypointBadgeEl(label, kind) })
          .setLngLat(p)
          .addTo(map)
        markers[i] = m
      } else {
        m.setLngLat(p)
        const el = m.getElement()
        el.className = `route-wp-badge route-wp-${kind}`
        el.textContent = label
      }
    })
    for (let i = anchors.length; i < markers.length; i++) markers[i]?.remove()
    markers.length = anchors.length
  }, [map, displayAnchors])

  // Remove all badge markers on unmount.
  useEffect(
    () => () => {
      wpMarkersRef.current.forEach((m) => m.remove())
      wpMarkersRef.current = []
    },
    [],
  )

  // Snap anchors to paths (debounced) whenever they change, snap is on, or the
  // activity's routing profile changes. Segments are cached so only the edited
  // parts re-fetch; any failure falls back to a straight line.
  useEffect(() => {
    if (!snap || waypoints.length < 2) {
      setSnappedLine([])
      setSnappedFor([])
      setRouting(false)
      return
    }
    const controller = new AbortController()
    const snapshot = waypoints
    setRouting(true)
    const timer = setTimeout(async () => {
      try {
        const result = await snapRoute(
          snapshot,
          activity.profile,
          routeCache.current,
          controller.signal,
        )
        setSnappedLine(result.line)
        setSnappedFor(snapshot)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSnappedLine([])
          setSnappedFor([])
        }
      } finally {
        setRouting(false)
      }
      // Short debounce: long enough to coalesce rapid taps, short enough that
      // the snapped path settles onto the trail almost immediately after the
      // instant straight stub is shown.
    }, 80)
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
        // Cancel any in-flight draw and show the whole line so dragging never
        // reveals a half-drawn path.
        if (drawAnimRef.current !== null) {
          cancelAnimationFrame(drawAnimRef.current)
          drawAnimRef.current = null
        }
        if (map.getLayer(LINE_LAYER)) {
          map.setPaintProperty(LINE_LAYER, 'line-gradient', revealGradient(1))
        }
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
      // Glue the numbered badge to the dot as it's dragged (state only commits
      // on release, so update this one imperatively for live feedback).
      wpMarkersRef.current[dragIndex]?.setLngLat([e.lngLat.lng, e.lngLat.lat])
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
      // DEM tiles are cached and quick, so a short debounce keeps the profile
      // updating snappily as points are placed.
    }, 180)
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

  // Stop following if the route is cleared out from under it.
  useEffect(() => {
    if (following && displayLine.length < 2) stopFollow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, displayLine])

  // Clear the geolocation watch + markers on unmount.
  useEffect(
    () => () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      gpsMarkerRef.current?.remove()
      progressMarkerRef.current?.remove()
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

  // Live refs so the geolocation watch callback always sees the current route.
  const displayLineRef = useRef(displayLine)
  displayLineRef.current = displayLine
  const totalRef = useRef(distance)
  totalRef.current = distance
  const ascentRef = useRef(profile?.ascent ?? 0)
  ascentRef.current = profile?.ascent ?? 0
  const activityObjRef = useRef(activity)
  activityObjRef.current = activity

  const stopFollow = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    gpsMarkerRef.current?.remove()
    gpsMarkerRef.current = null
    progressMarkerRef.current?.remove()
    progressMarkerRef.current = null
    setFollowing(false)
    setProgress(null)
  }

  const onFollowPos = (pos: GeolocationPosition) => {
    const line = displayLineRef.current
    if (line.length < 2) return
    const p: LngLat = [pos.coords.longitude, pos.coords.latitude]

    if (!gpsMarkerRef.current) {
      gpsMarkerRef.current = new maplibregl.Marker({ element: locationMarkerEl() })
        .setLngLat(p)
        .addTo(map)
    } else {
      gpsMarkerRef.current.setLngLat(p)
    }

    const { along, point, offset } = nearestOnPath(line, p)
    const total = totalRef.current
    const remaining = Math.max(0, total - along)
    const off = offset > OFF_ROUTE_M
    const arrived = remaining <= ARRIVE_M && !off

    if (!progressMarkerRef.current) {
      const el = document.createElement('div')
      el.className = 'route-progress-marker'
      progressMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(point)
        .addTo(map)
    } else {
      progressMarkerRef.current.setLngLat(point)
    }

    const frac = total > 0 ? along / total : 0
    const eta = estimateTimeSeconds(
      remaining,
      ascentRef.current * (1 - frac),
      activityObjRef.current,
    )
    setProgress({ remaining, offset, eta, arrived })
  }

  const startFollow = () => {
    if (!('geolocation' in navigator) || displayLine.length < 2) return
    setFollowing(true)
    setProgress(null)
    watchIdRef.current = navigator.geolocation.watchPosition(onFollowPos, undefined, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    })
  }

  const toggleFollow = () => {
    if (following) stopFollow()
    else startFollow()
  }

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
            {/* Keep the current chart on screen while the next profile computes so
                it updates in place instead of vanishing and popping back. */}
            {profile && (
              <div
                className={`route-elev-chart${elevLoading ? ' route-elev-updating' : ''}`}
              >
                <ElevationProfile data={profile} onScrub={setScrubDist} />
              </div>
            )}
            {!profile && elevLoading && (
              <div className="route-elev-msg">Loading elevation&hellip;</div>
            )}
            {!profile && !elevLoading && elevError && (
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
            {!profile && !elevLoading && !elevError && waypoints.length < 2 && (
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

          <button
            type="button"
            className={`route-follow${following ? ' is-active' : ''}`}
            onClick={toggleFollow}
            disabled={displayLine.length < 2}
          >
            {following ? 'Stop following' : 'Follow route'}
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

      {following &&
        createPortal(
          <div
            className={`follow-banner${progress && progress.offset > OFF_ROUTE_M ? ' is-off' : ''}${progress?.arrived ? ' is-arrived' : ''}`}
            role="status"
            aria-live="polite"
          >
            <div className="follow-banner-main">
              {!progress ? (
                <span className="follow-banner-line">Waiting for GPS…</span>
              ) : progress.arrived ? (
                <span className="follow-banner-line">You’ve arrived</span>
              ) : progress.offset > OFF_ROUTE_M ? (
                <>
                  <span className="follow-banner-line">
                    Off route · {Math.round(progress.offset)} m away
                  </span>
                  <span className="follow-banner-sub">
                    {formatDistance(progress.remaining)} to go
                  </span>
                </>
              ) : (
                <>
                  <span className="follow-banner-line">
                    {formatDistance(progress.remaining)} to go
                  </span>
                  <span className="follow-banner-sub">
                    {progress.eta !== null ? `~${formatDuration(progress.eta)} remaining` : ''}
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              className="follow-banner-stop"
              onClick={stopFollow}
              aria-label="Stop following route"
            >
              Stop
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
