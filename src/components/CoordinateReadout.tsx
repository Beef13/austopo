import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { formatLatLon, formatMga, toMga } from '../lib/grid'
import { fetchPointElevation } from '../lib/elevation'
import { formatElevation } from '../lib/geo'
import { elevationSync, ensureTile, sampleZoom } from '../lib/terrain'

type CoordinateReadoutProps = {
  map: maplibregl.Map
}

type Point = { lng: number; lat: number }

// Reads out a coordinate in decimal degrees + MGA/UTM grid reference, plus the
// terrain elevation there. On touch it reads the map centre (marked by the
// crosshair); on desktop it follows the mouse cursor over the map (the crosshair
// hides while hovering). Elevation is sampled in real time from the local DEM.
// Tap to copy.
export default function CoordinateReadout({ map }: CoordinateReadoutProps) {
  const [point, setPoint] = useState<Point>(() => {
    const c = map.getCenter()
    return { lng: c.lng, lat: c.lat }
  })
  const [elevation, setElevation] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const lastElevRef = useRef<number | null>(null)

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    let cancelled = false
    let probing = false
    let netController: AbortController | null = null
    let netTimer: ReturnType<typeof setTimeout>
    // The point currently being read out (centre, or the cursor while hovering).
    const active: Point = { lng: map.getCenter().lng, lat: map.getCenter().lat }

    const setElev = (v: number | null) => {
      const rounded = v === null ? null : Math.round(v)
      if (rounded === lastElevRef.current) return
      lastElevRef.current = rounded
      setElevation(v)
    }

    const networkFallback = (lng: number, lat: number) => {
      netController?.abort()
      clearTimeout(netTimer)
      netTimer = setTimeout(() => {
        netController = new AbortController()
        fetchPointElevation([lng, lat], netController.signal)
          .then((v) => {
            if (!cancelled) setElev(v)
          })
          .catch((err) => {
            if ((err as Error).name !== 'AbortError' && !cancelled) setElev(null)
          })
      }, 400)
    }

    const refreshElev = () => {
      const z = sampleZoom(map.getZoom())
      const v = elevationSync(active.lng, active.lat, z)
      if (v !== null) {
        setElev(v)
        return
      }
      ensureTile(active.lng, active.lat, z).then(() => {
        if (cancelled) return
        const vv = elevationSync(active.lng, active.lat, sampleZoom(map.getZoom()))
        if (vv !== null) setElev(vv)
        else networkFallback(active.lng, active.lat)
      })
    }

    const useCenter = () => {
      const c = map.getCenter()
      active.lng = c.lng
      active.lat = c.lat
      setPoint({ lng: c.lng, lat: c.lat })
      refreshElev()
    }

    const onMove = () => {
      if (!probing) useCenter()
      else refreshElev() // zoom may change; keep elevation current
    }

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      probing = true
      document.body.classList.add('cursor-probe')
      active.lng = e.lngLat.lng
      active.lat = e.lngLat.lat
      setPoint({ lng: active.lng, lat: active.lat })
      refreshElev()
    }

    const onMouseOut = () => {
      if (!probing) return
      probing = false
      document.body.classList.remove('cursor-probe')
      useCenter()
    }

    useCenter()
    map.on('move', onMove)
    if (fine) {
      map.on('mousemove', onMouseMove)
      map.on('mouseout', onMouseOut)
    }
    return () => {
      cancelled = true
      map.off('move', onMove)
      if (fine) {
        map.off('mousemove', onMouseMove)
        map.off('mouseout', onMouseOut)
      }
      document.body.classList.remove('cursor-probe')
      netController?.abort()
      clearTimeout(netTimer)
    }
  }, [map])

  const latLon = formatLatLon(point.lat, point.lng)
  const mga = formatMga(toMga(point.lng, point.lat), point.lat)
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
      aria-label={`Coordinates ${latLon}. ${mga}.${elev ? ` Elevation ${elev}.` : ''} Tap to copy.`}
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
