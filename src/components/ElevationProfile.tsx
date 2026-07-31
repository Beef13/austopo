import { useMemo, useRef, useState } from 'react'
import type { ElevationProfileData } from '../lib/elevation'
import { formatDistance } from '../lib/geo'

type ElevationProfileProps = {
  data: ElevationProfileData
  width?: number
  height?: number
  // Called with the distance (m) along the route being scrubbed, or null when
  // the pointer leaves, so the parent can show a marker on the map.
  onScrub?: (distance: number | null) => void
}

// Right margin holds the max/min elevation labels; the bottom holds distance
// ticks. Left margin is small since there's no left-hand axis.
const PAD = { top: 10, right: 40, bottom: 18, left: 6 }
// Approx width of one axis label character at the 9px label font.
const CHAR_PX = 5.6

// A distance tick label: whole km for very long routes, one decimal for km-scale
// routes, else metres. Keeping long-route labels short avoids them colliding.
function fmtTick(metres: number, total: number): string {
  if (total >= 100000) return `${Math.round(metres / 1000)} km`
  if (total >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.round(metres)} m`
}

export default function ElevationProfile({
  data,
  width = 268,
  height = 120,
  onScrub,
}: ElevationProfileProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const geom = useMemo(() => {
    const samples = data.samples
    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
    const totalDist = samples[samples.length - 1]?.distance || 1

    const span = Math.max(1, data.max - data.min)
    const lo = data.min - span * 0.1
    const hi = data.max + span * 0.1

    const x = (d: number) => PAD.left + (d / totalDist) * plotW
    const y = (e: number) => PAD.top + plotH - ((e - lo) / (hi - lo)) * plotH

    const line = samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.distance).toFixed(1)},${y(s.elevation).toFixed(1)}`)
      .join(' ')
    const area = `${line} L${x(totalDist).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${PAD.left.toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`

    return { areaPath: area, linePath: line, x, y, totalDist, plotH }
  }, [data, width, height])

  const samples = data.samples

  // Grade (%) around a sample, from the neighbouring points.
  const gradeAt = (i: number): number => {
    const a = samples[Math.max(0, i - 1)]
    const b = samples[Math.min(samples.length - 1, i + 1)]
    const dd = b.distance - a.distance
    return dd > 0 ? ((b.elevation - a.elevation) / dd) * 100 : 0
  }

  const updateFromClientX = (clientX: number) => {
    const svg = svgRef.current
    if (!svg || samples.length === 0) return
    const rect = svg.getBoundingClientRect()
    // Map screen x into viewBox units (the svg scales to 100% width).
    const vbX = ((clientX - rect.left) / rect.width) * width
    const frac = Math.max(0, Math.min(1, (vbX - PAD.left) / (width - PAD.left - PAD.right)))
    const target = frac * geom.totalDist
    // Nearest sample by distance.
    let idx = 0
    let best = Infinity
    for (let i = 0; i < samples.length; i++) {
      const d = Math.abs(samples[i].distance - target)
      if (d < best) {
        best = d
        idx = i
      }
    }
    setHoverIdx(idx)
    onScrub?.(samples[idx].distance)
  }

  const clear = () => {
    setHoverIdx(null)
    onScrub?.(null)
  }

  const hover = hoverIdx !== null ? samples[hoverIdx] : null
  const hx = hover ? geom.x(hover.distance) : 0
  const hy = hover ? geom.y(hover.elevation) : 0
  const grade = hoverIdx !== null ? gradeAt(hoverIdx) : 0
  // Readout text; anchor flips near the right edge to stay in view.
  const readout = hover
    ? `${formatDistance(hover.distance)} · ${Math.round(hover.elevation)} m · ${grade >= 0 ? '+' : ''}${Math.round(grade)}%`
    : ''
  const anchorRight = hx > width * 0.6

  return (
    <svg
      ref={svgRef}
      className="elev-chart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Elevation profile"
      onPointerMove={(e) => updateFromClientX(e.clientX)}
      onPointerDown={(e) => updateFromClientX(e.clientX)}
      onPointerLeave={clear}
      onPointerUp={clear}
    >
      <line
        x1={PAD.left}
        y1={height - PAD.bottom}
        x2={width - PAD.right}
        y2={height - PAD.bottom}
        className="elev-axis"
      />
      <path d={geom.areaPath} className="elev-area" />
      <path d={geom.linePath} className="elev-line" />

      {/* Max / min elevation on the right. */}
      <text x={width - 3} y={PAD.top + 4} className="elev-label" textAnchor="end">
        {Math.round(data.max)} m
      </text>
      <text
        x={width - 3}
        y={height - PAD.bottom}
        className="elev-label"
        textAnchor="end"
      >
        {Math.round(data.min)} m
      </text>

      {/* Evenly spaced distance ticks along the bottom. The count adapts to the
          available width and the widest label so they never overlap. */}
      {(() => {
        const plotW = width - PAD.left - PAD.right
        const labelPx = fmtTick(geom.totalDist, geom.totalDist).length * CHAR_PX
        const intervals = Math.max(1, Math.min(5, Math.floor(plotW / (labelPx + 22))))
        const count = intervals + 1
        return Array.from({ length: count }, (_, i) => {
          const frac = i / intervals
          const d = frac * geom.totalDist
          const anchor = i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'
          return (
            <text
              key={i}
              x={geom.x(d)}
              y={height - 4}
              className="elev-label"
              textAnchor={anchor}
            >
              {fmtTick(d, geom.totalDist)}
            </text>
          )
        })
      })()}

      {hover && (
        <g className="elev-cursor" pointerEvents="none">
          <line x1={hx} y1={PAD.top} x2={hx} y2={PAD.top + geom.plotH} className="elev-cursor-line" />
          <circle cx={hx} cy={hy} r={3.5} className="elev-cursor-dot" />
          <text
            x={anchorRight ? hx - 6 : hx + 6}
            y={PAD.top + 8}
            className="elev-readout"
            textAnchor={anchorRight ? 'end' : 'start'}
          >
            {readout}
          </text>
        </g>
      )}
    </svg>
  )
}
