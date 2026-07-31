import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import {
  bearing,
  circleRing,
  destination,
  formatArea,
  formatDistance,
  haversine,
  pathLength,
  polygonArea,
  type LngLat,
} from '../lib/geo'

type MeasureToolProps = {
  map: maplibregl.Map
  open: boolean
  onToggle: () => void
}

type Mode = 'distance' | 'area' | 'circle'
type CircleMetric = 'radius' | 'diameter'

const SOURCE_ID = 'measure'
const FILL_LAYER = 'measure-fill'
const LINE_LAYER = 'measure-line'
const GUIDE_LAYER = 'measure-guide'
const POINT_LAYER = 'measure-points'

const MEASURE_COLOR = '#0d9488'

// Build the line / polygon / vertex features for the current points and mode.
// - distance: a polyline through the points
// - area: a closed, filled polygon
// - circle: a filled disc around points[0] (centre) with radius to points[1],
//   plus a guide line — a spoke to the centre (radius) or a chord through it
//   (diameter).
function measureFeatures(
  points: LngLat[],
  mode: Mode,
  metric: CircleMetric = 'radius',
): FeatureCollection {
  const features: Feature[] = []

  if (mode === 'circle') {
    if (points.length >= 2) {
      const c = points[0]
      const edge = points[1]
      const r = haversine(c, edge)
      const ring = circleRing(c, r)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      })
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: ring },
        properties: { kind: 'ring' },
      })
      // The measurement guide line. The diameter passes explicitly through the
      // centre (as a middle vertex) so it always runs dead-centre through the
      // point — a single chord would bow off-centre in the map projection.
      const guide =
        metric === 'diameter'
          ? [destination(c, bearing(c, edge) + Math.PI, r), c, edge]
          : [c, edge]
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: guide },
        properties: { kind: 'guide' },
      })
    }
    points.forEach((p, i) => {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p },
        properties: { index: i, role: i === 0 ? 'center' : 'edge' },
      })
    })
    return { type: 'FeatureCollection', features }
  }

  if (mode === 'area' && points.length >= 3) {
    const ring = [...points, points[0]]
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {},
    })
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: ring },
      properties: {},
    })
  } else if (points.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points },
      properties: {},
    })
  }
  points.forEach((p, i) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { index: i },
    })
  })
  return { type: 'FeatureCollection', features }
}

function centroid(points: LngLat[]): LngLat {
  const sum = points.reduce(
    (acc, p) => [acc[0] + p[0], acc[1] + p[1]] as LngLat,
    [0, 0] as LngLat,
  )
  return [sum[0] / points.length, sum[1] / points.length]
}

export default function MeasureTool({ map, open, onToggle }: MeasureToolProps) {
  const [mode, setMode] = useState<Mode>('distance')
  const [circleMetric, setCircleMetric] = useState<CircleMetric>('radius')
  const [points, setPoints] = useState<LngLat[]>([])
  // While drawing a circle, the edge follows the cursor after the centre is set
  // (before the second click commits it).
  const [previewEdge, setPreviewEdge] = useState<LngLat | null>(null)
  const tipMarker = useRef<maplibregl.Marker | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const pointsRef = useRef(points)
  pointsRef.current = points
  const modeRef = useRef(mode)
  modeRef.current = mode
  const circleMetricRef = useRef(circleMetric)
  circleMetricRef.current = circleMetric

  // The geometry actually shown: the committed points, or (mid-draw) the centre
  // plus the live cursor edge so the circle grows as you move the mouse.
  const effPoints = useMemo<LngLat[]>(() => {
    if (mode === 'circle' && points.length === 1 && previewEdge) {
      return [points[0], previewEdge]
    }
    return points
  }, [mode, points, previewEdge])

  const distance = useMemo(() => pathLength(effPoints), [effPoints])
  const perimeter = useMemo(
    () => (effPoints.length >= 3 ? pathLength([...effPoints, effPoints[0]]) : distance),
    [effPoints, distance],
  )
  const area = useMemo(
    () => (mode === 'area' ? polygonArea(effPoints) : 0),
    [mode, effPoints],
  )
  // Circle measurements (only meaningful once a centre + edge exist).
  const radius = useMemo(
    () =>
      mode === 'circle' && effPoints.length >= 2 ? haversine(effPoints[0], effPoints[1]) : 0,
    [mode, effPoints],
  )
  const circleArea = Math.PI * radius * radius
  const circleValue = circleMetric === 'diameter' ? radius * 2 : radius

  // Create the source + layers once.
  useEffect(() => {
    const setup = () => {
      if (map.getSource(SOURCE_ID)) return
      map.addSource(SOURCE_ID, { type: 'geojson', data: measureFeatures([], 'distance') })
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': MEASURE_COLOR, 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['!=', ['get', 'kind'], 'guide'],
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': MEASURE_COLOR,
          'line-width': 3,
          'line-dasharray': [2, 1.6],
        },
      })
      // The circle's radius/diameter guide: a solid line so it stands out from
      // the dashed circle outline.
      map.addLayer({
        id: GUIDE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'guide'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': MEASURE_COLOR, 'line-width': 2 },
      })
      map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#fff',
          'circle-stroke-color': MEASURE_COLOR,
          'circle-stroke-width': 2.5,
        },
      })
    }
    setup()
    return () => {
      for (const id of [FILL_LAYER, LINE_LAYER, GUIDE_LAYER, POINT_LAYER]) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  }, [map])

  // Push the current geometry to the source.
  useEffect(() => {
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    src?.setData(measureFeatures(effPoints, mode, circleMetric))
  }, [map, effPoints, mode, circleMetric])

  // Map interactions while measuring. Distance/area: tap empty ground to add a
  // vertex (or tap the line to insert one there), tap a vertex to remove it, drag
  // to move. Circle: first tap sets the centre, second the radius; drag the centre
  // to move the whole circle or the edge to resize.
  useEffect(() => {
    const canvas = map.getCanvas()
    const srcGet = () => map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined

    let dragIndex = -1
    let moved = false
    let panned = false
    let downXY: maplibregl.Point | null = null
    let live: LngLat[] | null = null

    const onDragStart = () => {
      if (openRef.current && dragIndex < 0) panned = true
    }

    const setCursor = (c: string) => {
      canvas.style.cursor = c
    }
    const idleCursor = () => setCursor(openRef.current ? 'crosshair' : '')

    const pointIndexAt = (pt: maplibregl.Point, touch: boolean): number => {
      const tol = touch ? 24 : 16
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [pt.x - tol, pt.y - tol],
        [pt.x + tol, pt.y + tol],
      ]
      const feats = map.queryRenderedFeatures(box, { layers: [POINT_LAYER] })
      let best = -1
      let bestD = Infinity
      for (const f of feats) {
        if (!f.properties || f.geometry.type !== 'Point') continue
        const [lng, lat] = f.geometry.coordinates as [number, number]
        const p = map.project([lng, lat])
        const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2
        if (d < bestD) {
          bestD = d
          best = Number(f.properties.index)
        }
      }
      return best
    }

    // Squared pixel distance from a point to a segment.
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

    // The vertex index a click on the line falls after — measured against the
    // straight segments (area mode includes the closing segment).
    const insertIndexAt = (pt: maplibregl.Point): number => {
      const wp = pointsRef.current
      const closed = modeRef.current === 'area'
      const segCount = closed ? wp.length : wp.length - 1
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < segCount; i++) {
        const a = map.project(wp[i])
        const b = map.project(wp[(i + 1) % wp.length])
        const d = distToSeg(pt, a, b)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }

    // Keep the floating label in step with the geometry while dragging.
    const refreshTip = (pts: LngLat[]) => {
      const m = tipMarker.current
      if (!m) return
      const md = modeRef.current
      if (md === 'circle') {
        if (pts.length < 2) return
        const r = haversine(pts[0], pts[1])
        const val = circleMetricRef.current === 'diameter' ? r * 2 : r
        m.setLngLat(pts[1])
        m.getElement().textContent = formatDistance(val)
        return
      }
      const enough = md === 'area' ? pts.length >= 3 : pts.length >= 2
      if (!enough) return
      m.setLngLat(md === 'area' ? centroid(pts) : pts[pts.length - 1])
      m.getElement().textContent =
        md === 'area' ? formatArea(polygonArea(pts)) : formatDistance(pathLength(pts))
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
      const idx = pointIndexAt(e.point, 'touches' in e.originalEvent)
      // Only committed vertices are grabbable. During a circle preview a dot is
      // drawn under the cursor (index === points.length); ignore it so this click
      // commits the circle instead of grabbing that phantom handle.
      if (idx >= 0 && idx < pointsRef.current.length) {
        e.preventDefault()
        dragIndex = idx
        live = pointsRef.current.slice()
        map.dragPan.disable()
        setCursor('grabbing')
      }
    }

    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (downXY && Math.abs(e.point.x - downXY.x) + Math.abs(e.point.y - downXY.y) > 4) {
        moved = true
      }
      // Rubber-band the circle: once the centre is placed, the edge tracks the
      // cursor until the next click commits it.
      if (
        dragIndex < 0 &&
        openRef.current &&
        modeRef.current === 'circle' &&
        pointsRef.current.length === 1
      ) {
        setPreviewEdge([e.lngLat.lng, e.lngLat.lat])
        return
      }
      if (dragIndex < 0 || !live) return
      e.preventDefault()
      const np: LngLat = [e.lngLat.lng, e.lngLat.lat]
      // Dragging a circle's centre translates the whole disc (edge follows).
      if (modeRef.current === 'circle' && dragIndex === 0 && live.length >= 2) {
        const dLng = np[0] - live[0][0]
        const dLat = np[1] - live[0][1]
        live[0] = np
        live[1] = [live[1][0] + dLng, live[1][1] + dLat]
      } else {
        live[dragIndex] = np
      }
      srcGet()?.setData(measureFeatures(live, modeRef.current, circleMetricRef.current))
      refreshTip(live)
    }

    const onUp = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const wasPanned = panned
      panned = false
      // Finish a handle drag: commit a move, else treat as a tap on the handle.
      if (dragIndex >= 0) {
        const idx = dragIndex
        const committed = live
        dragIndex = -1
        live = null
        map.dragPan.enable()
        idleCursor()
        if (moved && committed) setPoints(committed)
        else if (modeRef.current !== 'circle') {
          // Tap on a vertex removes it (circle handles aren't removable).
          setPoints((prev) => prev.filter((_, i) => i !== idx))
        }
        downXY = null
        return
      }
      if (!openRef.current) {
        downXY = null
        return
      }
      if (moved || wasPanned) {
        downXY = null
        return
      }

      const np: LngLat = [e.lngLat.lng, e.lngLat.lat]
      if (modeRef.current === 'circle') {
        // Centre first, then edge; once both exist, Clear to start a new circle.
        setPreviewEdge(null)
        setPoints((prev) =>
          prev.length === 0 ? [np] : prev.length === 1 ? [prev[0], np] : prev,
        )
        downXY = null
        return
      }

      // Distance/area: insert on the line if the tap landed on it, else append.
      const tol = 'touches' in e.originalEvent ? 18 : 12
      const { x, y } = e.point
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [x - tol, y - tol],
        [x + tol, y + tol],
      ]
      const onLine = map.queryRenderedFeatures(box, { layers: [LINE_LAYER] })
      if (onLine.length && pointsRef.current.length >= 2) {
        const at = insertIndexAt(e.point) + 1
        setPoints((prev) => {
          const next = prev.slice()
          next.splice(at, 0, np)
          return next
        })
      } else {
        setPoints((prev) => [...prev, np])
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

  // Crosshair cursor while measuring.
  useEffect(() => {
    if (!open) return
    const canvas = map.getCanvas()
    const prev = canvas.style.cursor
    canvas.style.cursor = 'crosshair'
    return () => {
      canvas.style.cursor = prev
    }
  }, [map, open])

  // A floating label with the running measurement.
  useEffect(() => {
    const enough =
      mode === 'circle'
        ? effPoints.length >= 2
        : mode === 'area'
          ? effPoints.length >= 3
          : effPoints.length >= 2
    if (!open || !enough) {
      tipMarker.current?.remove()
      tipMarker.current = null
      return
    }
    let at: LngLat
    let text: string
    if (mode === 'circle') {
      at = effPoints[1]
      text = formatDistance(circleValue)
    } else if (mode === 'area') {
      at = centroid(effPoints)
      text = formatArea(area)
    } else {
      at = effPoints[effPoints.length - 1]
      text = formatDistance(distance)
    }
    if (!tipMarker.current) {
      const el = document.createElement('div')
      el.className = 'measure-tip'
      tipMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(at)
        .addTo(map)
    }
    tipMarker.current.setLngLat(at)
    tipMarker.current.getElement().textContent = text
  }, [open, mode, effPoints, distance, area, circleValue, map])

  // Remove the tip marker on unmount.
  useEffect(
    () => () => {
      tipMarker.current?.remove()
      tipMarker.current = null
    },
    [],
  )

  const undo = () => {
    setPreviewEdge(null)
    setPoints((prev) => prev.slice(0, -1))
  }
  const clear = () => {
    setPreviewEdge(null)
    setPoints([])
  }

  // Switching between polyline modes keeps the points; switching to/from circle
  // starts fresh since the geometry is different.
  const changeMode = (next: Mode) => {
    if ((mode === 'circle') !== (next === 'circle')) setPoints([])
    setPreviewEdge(null)
    setMode(next)
  }

  // Drop the live preview when the tool is minimised.
  useEffect(() => {
    if (!open) setPreviewEdge(null)
  }, [open])

  const enoughForArea = effPoints.length >= 3
  const hasCircle = mode === 'circle' && effPoints.length >= 2
  const needsPoints = mode === 'circle' ? effPoints.length < 2 : effPoints.length === 0
  const emptyHint =
    mode === 'circle'
      ? points.length === 0
        ? 'Tap to set the centre.'
        : 'Move to size, then tap to set the radius.'
      : mode === 'area'
        ? 'Tap 3+ points to enclose an area.'
        : 'Tap two or more points to measure a distance.'
  const headHint =
    mode === 'circle'
      ? 'Tap centre · move to size · tap to set'
      : 'Tap to add · tap the line to insert · tap a point to remove'

  return (
    <div className="measure-tool">
      <button
        type="button"
        className={`measure-btn${open ? ' is-open' : ''}`}
        onClick={onToggle}
        title="Measure distance, area or circle"
        aria-label="Measure distance, area or circle"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 15 15 4l5 5L9 20zM9 10l2 2m2-5 2 2m-7 6 2 2"
          />
        </svg>
      </button>

      <div
        className={`measure-panel${open ? ' is-open' : ' is-closed'}`}
        role="dialog"
        aria-label="Measure"
        aria-hidden={!open}
      >
        <div className="measure-panel-head">
          <span className="measure-panel-title">Measure</span>
          <span className="measure-panel-hint">{headHint}</span>
        </div>

        <div className="measure-modes" role="tablist" aria-label="Measure mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'distance'}
            className={mode === 'distance' ? 'is-active' : ''}
            onClick={() => changeMode('distance')}
          >
            Distance
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'area'}
            className={mode === 'area' ? 'is-active' : ''}
            onClick={() => changeMode('area')}
          >
            Area
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'circle'}
            className={mode === 'circle' ? 'is-active' : ''}
            onClick={() => changeMode('circle')}
          >
            Circle
          </button>
        </div>

        {mode === 'circle' && (
          <div
            className="measure-submodes"
            role="radiogroup"
            aria-label="Circle measurement"
          >
            <button
              type="button"
              role="radio"
              aria-checked={circleMetric === 'radius'}
              className={circleMetric === 'radius' ? 'is-active' : ''}
              onClick={() => setCircleMetric('radius')}
            >
              Radius
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={circleMetric === 'diameter'}
              className={circleMetric === 'diameter' ? 'is-active' : ''}
              onClick={() => setCircleMetric('diameter')}
            >
              Diameter
            </button>
          </div>
        )}

        <div className="measure-stats">
          {mode === 'distance' && (
            <div className="measure-stat">
              <span className="measure-stat-val">{formatDistance(distance)}</span>
              <span className="measure-stat-key">distance</span>
            </div>
          )}
          {mode === 'area' && (
            <>
              <div className="measure-stat">
                <span className="measure-stat-val">
                  {enoughForArea ? formatArea(area) : '\u2013'}
                </span>
                <span className="measure-stat-key">area</span>
              </div>
              <div className="measure-stat">
                <span className="measure-stat-val">
                  {enoughForArea ? formatDistance(perimeter) : '\u2013'}
                </span>
                <span className="measure-stat-key">perimeter</span>
              </div>
            </>
          )}
          {mode === 'circle' && (
            <>
              <div className="measure-stat">
                <span className="measure-stat-val">
                  {hasCircle ? formatDistance(circleValue) : '\u2013'}
                </span>
                <span className="measure-stat-key">{circleMetric}</span>
              </div>
              <div className="measure-stat">
                <span className="measure-stat-val">
                  {hasCircle ? formatArea(circleArea) : '\u2013'}
                </span>
                <span className="measure-stat-key">area</span>
              </div>
            </>
          )}
        </div>

        {needsPoints && <div className="measure-empty">{emptyHint}</div>}

        <div className="measure-actions">
          <button type="button" onClick={undo} disabled={points.length === 0}>
            Undo
          </button>
          <button type="button" onClick={clear} disabled={points.length === 0}>
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
