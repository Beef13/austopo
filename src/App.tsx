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
import MeasureTool from './components/MeasureTool'
import TrackRecorder from './components/TrackRecorder'
import UpdatePrompt from './components/UpdatePrompt'
import { DEFAULT_BASE_LAYER, type BaseLayerId } from './lib/mapStyle'
import { buildViewQuery, readViewFromUrl } from './lib/urlState'
import { useOnlineStatus } from './lib/useOnlineStatus'
import './App.css'

type PanelId = 'route' | 'pins' | 'measure' | 'offline'

export default function App() {
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [layer, setLayer] = useState<BaseLayerId>(
    () => readViewFromUrl().layer ?? DEFAULT_BASE_LAYER,
  )
  // Only one tool panel is open at a time; each tool keeps its own state while
  // minimised. `null` means everything is collapsed to its button.
  const [activePanel, setActivePanel] = useState<PanelId | null>(null)
  const togglePanel = (id: PanelId) =>
    setActivePanel((cur) => (cur === id ? null : id))
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
            <RouteTool
              map={map}
              open={activePanel === 'route'}
              onToggle={() => togglePanel('route')}
            />
            <PinTool
              map={map}
              open={activePanel === 'pins'}
              onToggle={() => togglePanel('pins')}
            />
            <MeasureTool
              map={map}
              open={activePanel === 'measure'}
              onToggle={() => togglePanel('measure')}
            />
            <TrackRecorder map={map} />
            <OfflinePanel
              map={map}
              layer={layer}
              open={activePanel === 'offline'}
              onToggle={() => togglePanel('offline')}
            />
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
