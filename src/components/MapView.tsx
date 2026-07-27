import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  AUSTRALIA_CENTER,
  AUSTRALIA_INITIAL_ZOOM,
  AUSTRALIA_MAX_BOUNDS,
  OPENTOPO_STYLE,
} from '../lib/mapStyle'

type MapViewProps = {
  onReady: (map: maplibregl.Map) => void
}

export default function MapView({ onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPENTOPO_STYLE,
      center: AUSTRALIA_CENTER,
      zoom: AUSTRALIA_INITIAL_ZOOM,
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

    map.on('load', () => onReadyRef.current(map))

    return () => map.remove()
  }, [])

  return <div ref={containerRef} className="map-container" />
}
