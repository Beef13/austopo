import type { LngLat } from './geo'

// Path-snapping via BRouter's free public server (https://brouter.de). It's
// CORS-enabled, needs no API key, and covers the whole planet with OSM-based
// foot/bike routing — a good fit for a topo trail app, and the same engine we
// can later bundle for fully offline routing.
export type BRouterProfile = 'hiking-mountain' | 'trekking'

const BROUTER_URL = 'https://brouter.de/brouter'

type BRouterResponse = {
  features?: {
    geometry?: { type?: string; coordinates?: number[][] }
  }[]
}

// Route between two points along paths. Returns the snapped polyline including
// both endpoints, or throws so callers can fall back to a straight segment.
export async function routeSegment(
  a: LngLat,
  b: LngLat,
  profile: BRouterProfile,
  signal?: AbortSignal,
): Promise<LngLat[]> {
  const lonlats = `${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`
  const url = `${BROUTER_URL}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`BRouter ${res.status}`)
  const data = (await res.json()) as BRouterResponse
  const coords = data.features?.[0]?.geometry?.coordinates
  if (!coords || coords.length < 2) throw new Error('BRouter: empty route')
  // BRouter returns [lng, lat, ele]; keep just [lng, lat].
  return coords.map((c) => [c[0], c[1]] as LngLat)
}

// A cache of already-routed segments keyed by endpoints + profile, so moving or
// adding one waypoint only re-fetches the affected segments.
export type SegmentCache = Map<string, LngLat[]>

function segKey(a: LngLat, b: LngLat, profile: string): string {
  return `${a[0]},${a[1]}>${b[0]},${b[1]}|${profile}`
}

// The snapped geometry previously computed for a segment, if any. Used by the
// UI to hit-test clicks against the line the user actually sees.
export function cachedSegment(
  a: LngLat,
  b: LngLat,
  profile: string,
  cache: SegmentCache,
): LngLat[] | undefined {
  return cache.get(segKey(a, b, profile))
}

export type SnapResult = {
  // The full drawn polyline (all segments concatenated).
  line: LngLat[]
  // Each anchor's position ON the line — i.e. where BRouter snapped it to the
  // nearest path — so the draggable dots sit on the line, not where the user
  // happened to tap off-trail.
  anchors: LngLat[]
}

// Snap a sequence of anchor waypoints to paths, segment by segment. Successful
// segments are cached; a segment that fails to route (no nearby path, provider
// down, offline) falls back to a straight line so the route is never broken.
export async function snapRoute(
  waypoints: LngLat[],
  profile: BRouterProfile,
  cache: SegmentCache,
  signal?: AbortSignal,
): Promise<SnapResult> {
  if (waypoints.length < 2) {
    return { line: waypoints.slice(), anchors: waypoints.slice() }
  }
  const line: LngLat[] = []
  const anchors: LngLat[] = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const key = segKey(a, b, profile)
    let seg = cache.get(key)
    if (!seg) {
      try {
        seg = await routeSegment(a, b, profile, signal)
        cache.set(key, seg)
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err
        seg = [a, b] // straight fallback; don't cache so we can retry later
      }
    }
    // Drop the shared junction vertex when appending later segments; the dot for
    // each anchor sits on the segment endpoint, guaranteeing it's on the line.
    if (i === 0) {
      line.push(...seg)
      anchors.push(seg[0])
    } else {
      line.push(...seg.slice(1))
    }
    anchors.push(seg[seg.length - 1])
  }
  return { line, anchors }
}
