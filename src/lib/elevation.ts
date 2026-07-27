import { sampleAlongPath, type LngLat } from './geo'

// Elevation data via the free, CORS-enabled Open-Meteo Elevation API
// (https://open-meteo.com/en/docs/elevation-api). No API key required; up to
// 100 coordinates per request, so we resample long routes down to 100 points.

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation'
const MAX_SAMPLES = 100
const MAX_ATTEMPTS = 3
const ATTEMPT_TIMEOUT_MS = 8000
const RETRY_DELAYS_MS = [500, 1200]

export type ElevationSample = { distance: number; elevation: number }

export type ElevationProfileData = {
  samples: ElevationSample[]
  ascent: number
  descent: number
  min: number
  max: number
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

// Fetch with a per-attempt timeout that still respects an outer abort signal.
async function fetchWithTimeout(url: string, signal?: AbortSignal) {
  const signals = [AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]
  if (signal) signals.push(signal)
  return fetch(url, { signal: AbortSignal.any(signals) })
}

// Replace null/NaN gaps (points Open-Meteo has no data for) by carrying the
// nearest valid neighbour forward and backward so the profile stays continuous.
function fillGaps(values: (number | null)[]): number[] | null {
  const out = values.map((v) => (typeof v === 'number' && isFinite(v) ? v : NaN))
  if (out.every((v) => Number.isNaN(v))) return null
  let last = NaN
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) out[i] = last
    else last = out[i]
  }
  // Back-fill any leading NaNs from the first valid value.
  let next = NaN
  for (let i = out.length - 1; i >= 0; i--) {
    if (Number.isNaN(out[i])) out[i] = next
    else next = out[i]
  }
  return out
}

export async function fetchElevationProfile(
  points: LngLat[],
  signal?: AbortSignal,
): Promise<ElevationProfileData | null> {
  if (points.length < 2) return null

  const { points: sampled, distances } = sampleAlongPath(points, MAX_SAMPLES)
  const lats = sampled.map((p) => p[1].toFixed(6)).join(',')
  const lngs = sampled.map((p) => p[0].toFixed(6)).join(',')
  const url = `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lngs}`

  let lastError: unknown
  let raw: (number | null)[] | undefined
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, signal)
      if (!res.ok) {
        // 4xx (other than 429) won't get better on retry.
        if (res.status !== 429 && res.status < 500) {
          throw new Error(`Elevation request failed: ${res.status}`)
        }
        throw new Error(`retryable:${res.status}`)
      }
      const data: { elevation?: (number | null)[] } = await res.json()
      raw = data.elevation
      break
    } catch (err) {
      // Caller aborted (new waypoint / unmount): bail immediately.
      if (signal?.aborted || (err as Error).name === 'AbortError') throw err
      lastError = err
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_DELAYS_MS[attempt], signal)
      }
    }
  }

  if (!raw) {
    if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError))
    return null
  }
  if (raw.length === 0) return null

  const elevations = fillGaps(raw)
  if (!elevations) return null

  const samples: ElevationSample[] = elevations.map((elevation, i) => ({
    distance: distances[i] ?? 0,
    elevation,
  }))

  let ascent = 0
  let descent = 0
  let min = elevations[0]
  let max = elevations[0]
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - elevations[i - 1]
    if (delta > 0) ascent += delta
    else descent -= delta
    if (elevations[i] < min) min = elevations[i]
    if (elevations[i] > max) max = elevations[i]
  }

  return { samples, ascent, descent, min, max }
}
