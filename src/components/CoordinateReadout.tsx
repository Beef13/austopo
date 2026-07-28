import { useEffect, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { formatLatLon, formatMga, toMga } from '../lib/grid'
import { fetchPointElevation } from '../lib/elevation'
import { formatElevation } from '../lib/geo'

type CoordinateReadoutProps = {
  map: maplibregl.Map
}

// Reads out the coordinate at the map's centre (marked by a crosshair), in both
// decimal degrees and MGA/UTM grid reference, plus the terrain elevation there.
// Tap to copy.
export default function CoordinateReadout({ map }: CoordinateReadoutProps) {
  const [center, setCenter] = useState(() => map.getCenter())
  const [elevation, setElevation] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const update = () => setCenter(map.getCenter())
    map.on('move', update)
    return () => {
      map.off('move', update)
    }
  }, [map])

  // Fetch the centre elevation after the view settles (debounced), aborting any
  // in-flight request when the map moves again.
  useEffect(() => {
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout>

    const run = () => {
      controller?.abort()
      clearTimeout(timer)
      timer = setTimeout(() => {
        controller = new AbortController()
        const c = map.getCenter()
        fetchPointElevation([c.lng, c.lat], controller.signal)
          .then(setElevation)
          .catch((err) => {
            if ((err as Error).name !== 'AbortError') setElevation(null)
          })
      }, 400)
    }

    run()
    map.on('moveend', run)
    return () => {
      controller?.abort()
      clearTimeout(timer)
      map.off('moveend', run)
    }
  }, [map])

  const lat = center.lat
  const lon = center.lng
  const latLon = formatLatLon(lat, lon)
  const mga = formatMga(toMga(lon, lat), lat)
  const elev = elevation !== null ? formatElevation(elevation) : null

  const copy = async () => {
    try {
      const text = elev ? `${latLon}\n${mga}\nElevation ${elev}` : `${latLon}\n${mga}`
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard may be unavailable (e.g. insecure context); ignore.
    }
  }

  return (
    <button
      type="button"
      className="coord-readout"
      onClick={copy}
      title="Copy coordinates"
      aria-label={`Centre coordinates ${latLon}. ${mga}.${elev ? ` Elevation ${elev}.` : ''} Tap to copy.`}
    >
      {copied ? (
        <span className="coord-copied">Copied</span>
      ) : (
        <>
          <span className="coord-latlon">{latLon}</span>
          <span className="coord-mga">{mga}</span>
          {elev && (
            <span className="coord-elev">
              <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
                <path d="M12 4 3 20h18L12 4Z" fill="currentColor" />
              </svg>
              {elev}
            </span>
          )}
        </>
      )}
    </button>
  )
}
