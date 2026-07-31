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

// The closest position on a polyline to a point, using a local planar
// approximation (accurate at the scale of a GPS-to-route offset). Returns the
// distance along the line to that position, the position itself, and the
// perpendicular offset — all in metres.
export function nearestOnPath(
  points: LngLat[],
  p: LngLat,
): { along: number; point: LngLat; offset: number } {
  if (points.length === 0) return { along: 0, point: p, offset: 0 }
  if (points.length === 1) {
    return { along: 0, point: points[0], offset: haversine(points[0], p) }
  }
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((p[1] * Math.PI) / 180)
  const toXY = (q: LngLat): [number, number] => [
    (q[0] - p[0]) * mPerDegLng,
    (q[1] - p[1]) * mPerDegLat,
  ]

  let best = { d2: Infinity, along: 0, point: points[0] }
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const a = toXY(points[i - 1])
    const b = toXY(points[i])
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const len2 = abx * abx + aby * aby || 1
    // Project the origin (the query point p) onto segment a->b.
    let t = -((a[0] * abx + a[1] * aby) / len2)
    t = Math.max(0, Math.min(1, t))
    const projX = a[0] + t * abx
    const projY = a[1] + t * aby
    const d2 = projX * projX + projY * projY
    const segLen = haversine(points[i - 1], points[i])
    if (d2 < best.d2) {
      best = {
        d2,
        along: acc + t * segLen,
        point: lerp(points[i - 1], points[i], t),
      }
    }
    acc += segLen
  }
  return { along: best.along, point: best.point, offset: Math.sqrt(best.d2) }
}

// The leading portion of a polyline up to `dist` metres, with the final point
// interpolated exactly at `dist`. Used to animate "drawing" a line.
export function takeAlong(points: LngLat[], dist: number): LngLat[] {
  if (points.length === 0) return []
  if (points.length === 1 || dist <= 0) return [points[0]]
  const out: LngLat[] = [points[0]]
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const seg = haversine(points[i - 1], points[i])
    if (acc + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - acc) / seg
      out.push(lerp(points[i - 1], points[i], t))
      return out
    }
    acc += seg
    out.push(points[i])
  }
  return out
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

// Area of a polygon (a ring of [lng, lat] points, implicitly closed) in square
// metres, using the spherical excess formula. Sign is dropped so winding order
// doesn't matter.
export function polygonArea(ring: LngLat[]): number {
  if (ring.length < 3) return 0
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += toRad(b[0] - a[0]) * (2 + Math.sin(toRad(a[1])) + Math.sin(toRad(b[1])))
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
}

// The [lng, lat] reached by travelling `distM` metres from `start` on the given
// bearing (radians, clockwise from north), on a sphere.
export function destination(start: LngLat, bearingRad: number, distM: number): LngLat {
  const lat1 = toRad(start[1])
  const lng1 = toRad(start[0])
  const dr = distM / EARTH_RADIUS_M
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(bearingRad),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    )
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]
}

// Initial bearing (radians, clockwise from north) from `a` to `b`.
export function bearing(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLng = toRad(b[0] - a[0])
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return Math.atan2(y, x)
}

// A closed ring approximating a geodesic circle of `radiusM` around `center`.
export function circleRing(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const ring: LngLat[] = []
  for (let i = 0; i <= steps; i++) {
    ring.push(destination(center, (2 * Math.PI * i) / steps, radiusM))
  }
  return ring
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`
}

// Human-friendly area: m² up to a hectare, hectares up to a km², then km².
export function formatArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2)} m\u00b2`
  if (m2 < 1_000_000) return `${(m2 / 10000).toFixed(2)} ha`
  return `${(m2 / 1_000_000).toFixed(2)} km\u00b2`
}

export function formatElevation(metres: number): string {
  return `${Math.round(metres)} m`
}
