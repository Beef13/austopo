import { stitchSegment } from '../src/lib/routing'
import type { LngLat } from '../src/lib/geo'

// Points spaced ~11m apart in longitude at this latitude for realistic metres.
const lat = -37.98
const P = (n: number): LngLat => [145.0 + n * 0.0001, lat]
const A = P(0)
const x2 = P(1)
const x1 = P(2)
const B = P(3) // junction / waypoint
const x3 = P(4)
const C = P(5)

const eq = (a: LngLat, b: LngLat) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
const show = (l: LngLat[]) => l.map((p) => Math.round((p[0] - 145) * 10000)).join(',')

const results: Record<string, boolean> = {}

// 1) Short out-and-back spur at B should be trimmed: A x2 x1 B  +  B x1 x2 x3 C
{
  const line: LngLat[] = [...[A, x2, x1, B]]
  stitchSegment(line, [B, x1, x2, x3, C])
  // Expect A, x2, x3, C (spur to B removed).
  const expected = [A, x2, x3, C]
  results.trimsShortSpur =
    line.length === expected.length && line.every((p, i) => eq(p, expected[i]))
  if (!results.trimsShortSpur) console.log('  short spur got:', show(line))
}

// 2) No overlap (continues forward) should be preserved: A B + B C
{
  const line: LngLat[] = [A, B]
  stitchSegment(line, [B, C])
  results.keepsForward = show(line) === show([A, B, C])
  if (!results.keepsForward) console.log('  forward got:', show(line))
}

// 3) A long deliberate out-and-back (overlap > MAX_SPUR_TRIM_M ~150m) is kept.
{
  // ~30m spacing * many points => overlap > 150m.
  const Q = (n: number): LngLat => [145.5 + n * 0.0003, lat]
  const start = Q(0)
  const mids = [Q(1), Q(2), Q(3), Q(4), Q(5), Q(6)] // ~160m of stubs
  const tip = Q(7)
  const segIn = [start, ...mids, tip]
  const segOut = [tip, ...mids.slice().reverse(), start, Q(-1)]
  const line: LngLat[] = [...segIn]
  stitchSegment(line, segOut)
  // Since overlap is long, it should NOT be trimmed -> line keeps the return leg.
  results.keepsLongDetour = line.length === segIn.length + segOut.length - 1
  if (!results.keepsLongDetour)
    console.log('  long detour len:', line.length, 'expected', segIn.length + segOut.length - 1)
}

// 4) A SHORT deliberate out-and-back (return leg fully retraces) is preserved,
//    because the whole segment overlaps (m === seg.length), not just a stub.
{
  const start = P(0)
  const mid = P(1)
  const tip = P(2)
  const line: LngLat[] = [start, mid, tip] // forward leg
  stitchSegment(line, [tip, mid, start]) // return leg fully reversed, short
  results.keepsShortOutAndBack = show(line) === show([start, mid, tip, mid, start])
  if (!results.keepsShortOutAndBack) console.log('  short out-and-back got:', show(line))
}

const allOk = Object.values(results).every(Boolean)
console.log(JSON.stringify({ allOk, results }, null, 2))
process.exit(allOk ? 0 : 1)
