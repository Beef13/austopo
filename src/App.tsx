import { useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import MapView from './components/MapView'
import SearchBar from './components/SearchBar'
import LocateControl from './components/LocateControl'
import LayerSwitcher from './components/LayerSwitcher'
import CoordinateReadout from './components/CoordinateReadout'
import './App.css'

export default function App() {
  const [map, setMap] = useState<maplibregl.Map | null>(null)

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

      {/* Crosshair marks the point the coordinate readout refers to. */}
      <div className="center-crosshair" aria-hidden="true" />

      {map && (
        <>
          <div className="floating-controls">
            <LayerSwitcher map={map} />
            <LocateControl map={map} />
          </div>
          <CoordinateReadout map={map} />
        </>
      )}
    </div>
  )
}
