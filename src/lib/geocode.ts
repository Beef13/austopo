// Place search via the OpenStreetMap Nominatim geocoder.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//  - Max ~1 request/second (we debounce input in the SearchBar).
//  - A valid identifying Referer/User-Agent is required. Browsers send a
//    Referer automatically; the custom header below documents intent.
//  - Results are bounded to Australia via countrycodes=au.

export type GeocodeResult = {
  id: number
  label: string
  lat: number
  lon: number
  bbox?: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

type NominatimItem = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  boundingbox?: [string, string, string, string] // [minLat, maxLat, minLon, maxLon]
}

export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    countrycodes: 'au',
    limit: '6',
    addressdetails: '0',
  })

  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    signal,
    headers: { 'Accept-Language': 'en' },
  })
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`)

  const data: NominatimItem[] = await res.json()
  return data.map((item) => ({
    id: item.place_id,
    label: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
    bbox: item.boundingbox
      ? [
          Number(item.boundingbox[2]),
          Number(item.boundingbox[0]),
          Number(item.boundingbox[3]),
          Number(item.boundingbox[1]),
        ]
      : undefined,
  }))
}
