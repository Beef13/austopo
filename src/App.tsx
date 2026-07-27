import { useEffect, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import MapView from './components/MapView'
import SearchBar from './components/SearchBar'
import LocateControl from './components/LocateControl'
import LayerSwitcher from './components/LayerSwitcher'
import CoordinateReadout from './components/CoordinateReadout'
import ShareControl from './components/ShareControl'
import OfflinePanel from './components/OfflinePanel'
import RouteTool from './components/RouteTool'
import PinTool from './components/PinTool'
import TrackRecorder from './components/TrackRecorder'
import UpdatePrompt from './components/UpdatePrompt'
import type { BaseLayerId } from './lib/mapStyle'
import { buildViewQuery, readViewFromUrl } from './lib/urlState'
import { useOnlineStatus } from './lib/useOnlineStatus'
import './App.css'

export default function App() {
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [layer, setLayer] = useState<BaseLayerId>(
    () => readViewFromUrl().layer ?? 'opentopomap',
  )
  const online = useOnlineStatus()
  const layerRef = useRef(layer)
  layerRef.current = layer

  // Keep the URL in sync with the current view so it can be shared / restored.
  useEffect(() => {
    if (!map) return
    const sync = () => {
      const c = map.getCenter()
      const query = buildViewQuery({
        lat: c.lat,
        lng: c.lng,
        zoom: map.getZoom(),
        layer: layerRef.current,
      })
      window.history.replaceState(null, '', query)
    }
    sync()
    map.on('moveend', sync)
    return () => {
      map.off('moveend', sync)
    }
  }, [map, layer])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">AusTopo</span>
        </div>
        {map && <SearchBar map={map} />}
      </header>

      <MapView onReady={setMap} />

      {!map && (
        <div className="map-loading" role="status">
          <span className="map-loading-spinner" aria-hidden="true" />
          <span>Loading map&hellip;</span>
        </div>
      )}

      <div className="center-crosshair" aria-hidden="true" />

      {!online && (
        <div className="offline-badge" role="status">
          Offline &mdash; showing downloaded maps
        </div>
      )}

      {map && (
        <>
          <div className="floating-controls">
            <RouteTool map={map} />
            <PinTool map={map} />
            <TrackRecorder map={map} />
            <OfflinePanel map={map} layer={layer} />
            <LayerSwitcher map={map} active={layer} onChange={setLayer} />
            <LocateControl map={map} />
          </div>
          <div className="bottom-bar">
            <CoordinateReadout map={map} />
            <ShareControl map={map} layer={layer} />
          </div>
        </>
      )}

      <UpdatePrompt />
    </div>
  )
}
