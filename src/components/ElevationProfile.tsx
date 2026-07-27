import { useMemo } from 'react'
import type { ElevationProfileData } from '../lib/elevation'
import { formatDistance } from '../lib/geo'

type ElevationProfileProps = {
  data: ElevationProfileData
  width?: number
  height?: number
}

const PAD = { top: 8, right: 8, bottom: 18, left: 34 }

export default function ElevationProfile({
  data,
  width = 268,
  height = 120,
}: ElevationProfileProps) {
  const { areaPath, linePath, min, max, totalDistance } = useMemo(() => {
    const samples = data.samples
    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
    const totalDist = samples[samples.length - 1]?.distance || 1

    // Pad the elevation range a little so the line isn't glued to the edges.
    const rawMin = data.min
    const rawMax = data.max
    const span = Math.max(1, rawMax - rawMin)
    const lo = rawMin - span * 0.1
    const hi = rawMax + span * 0.1

    const x = (d: number) => PAD.left + (d / totalDist) * plotW
    const y = (e: number) => PAD.top + plotH - ((e - lo) / (hi - lo)) * plotH

    const line = samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.distance).toFixed(1)},${y(s.elevation).toFixed(1)}`)
      .join(' ')
    const area = `${line} L${x(totalDist).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${PAD.left.toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`

    return {
      areaPath: area,
      linePath: line,
      min: rawMin,
      max: rawMax,
      totalDistance: totalDist,
    }
  }, [data, width, height])

  return (
    <svg
      className="elev-chart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Elevation profile"
    >
      <line
        x1={PAD.left}
        y1={height - PAD.bottom}
        x2={width - PAD.right}
        y2={height - PAD.bottom}
        className="elev-axis"
      />
      <path d={areaPath} className="elev-area" />
      <path d={linePath} className="elev-line" />

      <text x={2} y={PAD.top + 6} className="elev-label">
        {Math.round(max)}m
      </text>
      <text x={2} y={height - PAD.bottom} className="elev-label">
        {Math.round(min)}m
      </text>
      <text x={PAD.left} y={height - 4} className="elev-label">
        0
      </text>
      <text x={width - PAD.right} y={height - 4} className="elev-label" textAnchor="end">
        {formatDistance(totalDistance)}
      </text>
    </svg>
  )
}
