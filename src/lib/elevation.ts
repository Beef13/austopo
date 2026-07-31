import { sampleAlongPath, type LngLat } from './geo'
import { sampleElevations } from './terrain'

// Elevation data. Primary source is the local AWS "terrarium" DEM tiles (see
// terrain.ts) — no API key, no rate limits, cached by the service worker so it
// works offline, and it's the same source as the live centre readout so the
// numbers always agree. Open-Meteo's elevation API is kept only as a fallback
// for the rare case the DEM tiles can't be fetched (offline with an empty
// cache), since relying on it alone made the profile flaky under load.

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

// Query the Open-Meteo elevation endpoint with retries/backoff. Returns the raw
// (possibly gappy) elevation array, or throws after exhausting retries.
async function requestElevations(
  url: string,
  signal?: AbortSignal,
): Promise<(number | null)[]> {
  let lastError: unknown
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
      return data.elevation ?? []
    } catch (err) {
      // Caller aborted (new waypoint / unmount): bail immediately.
      if (signal?.aborted || (err as Error).name === 'AbortError') throw err
      lastError = err
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_DELAYS_MS[attempt], signal)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// Elevation (m) at a single point, or null when unavailable.
export async function fetchPointElevation(
  point: LngLat,
  signal?: AbortSignal,
): Promise<number | null> {
  const url = `${OPEN_METEO_URL}?latitude=${point[1].toFixed(6)}&longitude=${point[0].toFixed(6)}`
  const raw = await requestElevations(url, signal)
  const v = raw[0]
  return typeof v === 'number' && isFinite(v) ? v : null
}

export async function fetchElevationProfile(
  points: LngLat[],
  signal?: AbortSignal,
): Promise<ElevationProfileData | null> {
  if (points.length < 2) return null

  const { points: sampled, distances } = sampleAlongPath(points, MAX_SAMPLES)

  // Primary: local DEM tiles. Reliable and offline-capable.
  let elevations: number[] | null = null
  try {
    const dem = await sampleElevations(sampled, signal)
    elevations = fillGaps(dem)
  } catch (err) {
    if (signal?.aborted || (err as Error).name === 'AbortError') throw err
    elevations = null
  }

  // Fallback: Open-Meteo, only if the DEM yielded nothing at all.
  if (!elevations) {
    const lats = sampled.map((p) => p[1].toFixed(6)).join(',')
    const lngs = sampled.map((p) => p[0].toFixed(6)).join(',')
    const url = `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lngs}`
    const raw = await requestElevations(url, signal)
    if (raw.length > 0) elevations = fillGaps(raw)
  }
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
