import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  AUSTRALIA_CENTER,
  AUSTRALIA_INITIAL_ZOOM,
  AUSTRALIA_MAX_BOUNDS,
  OPENTOPO_STYLE,
} from '../lib/mapStyle'
import { readViewFromUrl } from '../lib/urlState'

type MapViewProps = {
  onReady: (map: maplibregl.Map) => void
}

export default function MapView({ onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    if (!containerRef.current) return

    const initial = readViewFromUrl()
    const center: [number, number] =
      initial.lng !== undefined && initial.lat !== undefined
        ? [initial.lng, initial.lat]
        : AUSTRALIA_CENTER

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPENTOPO_STYLE,
      center,
      zoom: initial.zoom ?? AUSTRALIA_INITIAL_ZOOM,
      maxBounds: AUSTRALIA_MAX_BOUNDS,
      maxZoom: 18,
      attributionControl: false,
    })

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    )
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )

    // Surface the UI as soon as the map is ready. Normally this is the 'load'
    // event, but if the default layer's tiles can't be fetched (bad API key,
    // offline first-run, provider outage) 'load' may never fire — so a fallback
    // timeout guarantees the controls still appear instead of a stuck splash.
    let signalled = false
    const ready = () => {
      if (signalled) return
      signalled = true
      onReadyRef.current(map)
    }
    map.on('load', ready)
    const fallback = window.setTimeout(ready, 4000)

    return () => {
      window.clearTimeout(fallback)
      map.remove()
    }
  }, [])

  return <div ref={containerRef} className="map-container" />
}
