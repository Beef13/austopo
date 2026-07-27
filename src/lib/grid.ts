import proj4 from 'proj4'

// Map Grid of Australia (MGA) is UTM applied to the Australian datum. We use a
// WGS84 UTM projection here; the difference from GDA2020 is well under ~2 m,
// which is immaterial for an on-screen readout.

export type MgaRef = {
  zone: number
  easting: number
  northing: number
}

// UTM/MGA zone from longitude (Australia spans zones 49-56).
function zoneForLon(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1
}

export function toMga(lon: number, lat: number): MgaRef {
  const zone = zoneForLon(lon)
  const proj = `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
  const [easting, northing] = proj4('WGS84', proj, [lon, lat])
  return { zone, easting: Math.round(easting), northing: Math.round(northing) }
}

// e.g. "MGA Z56 55H 334512E 6251043N"
export function formatMga(ref: MgaRef, lat: number): string {
  const band = latitudeBand(lat)
  return `MGA Z${ref.zone}${band} ${ref.easting}mE ${ref.northing}mN`
}

// Formats decimal degrees like "33.8568° S, 151.2153° E".
export function formatLatLon(lat: number, lon: number): string {
  const latHem = lat >= 0 ? 'N' : 'S'
  const lonHem = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}\u00b0 ${latHem}, ${Math.abs(lon).toFixed(4)}\u00b0 ${lonHem}`
}

// MGRS-style latitude band letter (C-X, omitting I and O).
function latitudeBand(lat: number): string {
  const bands = 'CDEFGHJKLMNPQRSTUVWX'
  const clamped = Math.max(-80, Math.min(84, lat))
  const idx = Math.floor((clamped + 80) / 8)
  return bands[Math.min(idx, bands.length - 1)]
}
