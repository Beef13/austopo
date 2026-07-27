import { useEffect, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { formatLatLon, formatMga, toMga } from '../lib/grid'

type CoordinateReadoutProps = {
  map: maplibregl.Map
}

// Reads out the coordinate at the map's centre (marked by a crosshair), in both
// decimal degrees and MGA/UTM grid reference. Tap to copy.
export default function CoordinateReadout({ map }: CoordinateReadoutProps) {
  const [center, setCenter] = useState(() => map.getCenter())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const update = () => setCenter(map.getCenter())
    map.on('move', update)
    return () => {
      map.off('move', update)
    }
  }, [map])

  const lat = center.lat
  const lon = center.lng
  const latLon = formatLatLon(lat, lon)
  const mga = formatMga(toMga(lon, lat), lat)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${latLon}\n${mga}`)
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
      aria-label={`Centre coordinates ${latLon}. ${mga}. Tap to copy.`}
    >
      {copied ? (
        <span className="coord-copied">Copied</span>
      ) : (
        <>
          <span className="coord-latlon">{latLon}</span>
          <span className="coord-mga">{mga}</span>
        </>
      )}
    </button>
  )
}
