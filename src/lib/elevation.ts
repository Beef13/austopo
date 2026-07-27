import { sampleAlongPath, type LngLat } from './geo'

// Elevation data via the free, CORS-enabled Open-Meteo Elevation API
// (https://open-meteo.com/en/docs/elevation-api). No API key required; up to
// 100 coordinates per request, so we resample long routes down to 100 points.

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation'
const MAX_SAMPLES = 100

export type ElevationSample = { distance: number; elevation: number }

export type ElevationProfileData = {
  samples: ElevationSample[]
  ascent: number
  descent: number
  min: number
  max: number
}

export async function fetchElevationProfile(
  points: LngLat[],
  signal?: AbortSignal,
): Promise<ElevationProfileData | null> {
  if (points.length < 2) return null

  const { points: sampled, distances } = sampleAlongPath(points, MAX_SAMPLES)
  const lats = sampled.map((p) => p[1].toFixed(6)).join(',')
  const lngs = sampled.map((p) => p[0].toFixed(6)).join(',')

  const res = await fetch(
    `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lngs}`,
    { signal },
  )
  if (!res.ok) throw new Error(`Elevation request failed: ${res.status}`)

  const data: { elevation?: number[] } = await res.json()
  const elevations = data.elevation
  if (!elevations || elevations.length === 0) return null

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
