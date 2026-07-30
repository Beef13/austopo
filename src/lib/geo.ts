export type LngLat = [number, number]

const EARTH_RADIUS_M = 6371008.8

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

// Great-circle distance between two [lng, lat] points, in metres.
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

// Total length of a polyline in metres.
export function pathLength(points: LngLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i])
  }
  return total
}

// Linearly interpolate between two [lng, lat] points.
function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

// Resample a polyline into `count` points evenly spaced by distance. Returns
// the sampled points plus the cumulative distance (m) at each sample.
export function sampleAlongPath(
  points: LngLat[],
  count: number,
): { points: LngLat[]; distances: number[] } {
  if (points.length === 0) return { points: [], distances: [] }
  if (points.length === 1) return { points: [points[0]], distances: [0] }

  const segLengths: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1], points[i])
    segLengths.push(d)
    total += d
  }
  if (total === 0) return { points: [points[0]], distances: [0] }

  const sampledPoints: LngLat[] = []
  const distances: number[] = []
  for (let s = 0; s < count; s++) {
    const target = (total * s) / (count - 1)
    let acc = 0
    let seg = 0
    while (seg < segLengths.length - 1 && acc + segLengths[seg] < target) {
      acc += segLengths[seg]
      seg++
    }
    const segLen = segLengths[seg] || 1
    const t = Math.min(1, Math.max(0, (target - acc) / segLen))
    sampledPoints.push(lerp(points[seg], points[seg + 1], t))
    distances.push(target)
  }
  return { points: sampledPoints, distances }
}

// The [lng, lat] a given distance (metres) along a polyline. Clamps to the
// endpoints for out-of-range distances.
export function pointAtDistance(points: LngLat[], target: number): LngLat {
  if (points.length === 0) return [0, 0]
  if (points.length === 1 || target <= 0) return points[0]
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const seg = haversine(points[i - 1], points[i])
    if (acc + seg >= target) {
      const t = seg === 0 ? 0 : (target - acc) / seg
      return lerp(points[i - 1], points[i], t)
    }
    acc += seg
  }
  return points[points.length - 1]
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`
}

export function formatElevation(metres: number): string {
  return `${Math.round(metres)} m`
}
