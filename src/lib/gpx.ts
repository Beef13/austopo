import type { LngLat } from './geo'

// Minimal GPX 1.1 support: export a route as a track, and import track/route
// points from a GPX file.

export function buildGpx(points: LngLat[], name = 'AusTopo route'): string {
  const now = new Date().toISOString()
  const trkpts = points
    .map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="AusTopo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

export function parseGpx(xml: string): LngLat[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid GPX file')
  }

  // Prefer track points; fall back to route points, then standalone waypoints.
  const selectors = ['trkpt', 'rtept', 'wpt']
  for (const sel of selectors) {
    const nodes = Array.from(doc.getElementsByTagName(sel))
    if (nodes.length > 0) {
      const points: LngLat[] = []
      for (const node of nodes) {
        const lat = parseFloat(node.getAttribute('lat') ?? '')
        const lon = parseFloat(node.getAttribute('lon') ?? '')
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push([lon, lat])
        }
      }
      if (points.length > 0) return points
    }
  }
  throw new Error('No track, route, or waypoints found in GPX')
}

export function downloadGpx(points: LngLat[], filename = 'austopo-route.gpx'): void {
  triggerDownload(buildGpx(points), filename)
}

// A recorded GPS track point, with optional elevation and timestamp.
export type TrackPoint = { lng: number; lat: number; ele?: number; time?: number }

export function buildTrackGpx(points: TrackPoint[], name = 'AusTopo track'): string {
  const now = new Date().toISOString()
  const trkpts = points
    .map((p) => {
      const parts = [`      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">`]
      if (typeof p.ele === 'number' && isFinite(p.ele)) {
        parts.push(`        <ele>${p.ele.toFixed(1)}</ele>`)
      }
      if (typeof p.time === 'number' && isFinite(p.time)) {
        parts.push(`        <time>${new Date(p.time).toISOString()}</time>`)
      }
      parts.push('      </trkpt>')
      return parts.join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="AusTopo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

export function downloadTrackGpx(
  points: TrackPoint[],
  filename = 'austopo-track.gpx',
): void {
  triggerDownload(buildTrackGpx(points), filename)
}

// A named point of interest for GPX waypoint export.
export type GpxWaypoint = { lng: number; lat: number; name: string }

export function buildWaypointGpx(
  pins: GpxWaypoint[],
  name = 'AusTopo pins',
): string {
  const now = new Date().toISOString()
  const wpts = pins
    .map(
      (p) =>
        `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">\n` +
        `    <name>${escapeXml(p.name)}</name>\n` +
        `  </wpt>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="AusTopo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
${wpts}
</gpx>
`
}

export function downloadWaypointGpx(
  pins: GpxWaypoint[],
  filename = 'austopo-pins.gpx',
): void {
  triggerDownload(buildWaypointGpx(pins), filename)
}

function triggerDownload(gpx: string, filename: string): void {
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
