import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { downloadWaypointGpx } from '../lib/gpx'
import {
  addPin,
  deletePin,
  listPins,
  renamePin,
  updatePinPosition,
  type Pin,
} from '../lib/savedPins'

type PinToolProps = {
  map: maplibregl.Map
}

const PIN_COLOR = '#1565c0'

function createPinElement(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'map-pin'
  el.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z"
      fill="${PIN_COLOR}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="9" r="2.6" fill="#fff"/>
  </svg>`
  return el
}

export default function PinTool({ map }: PinToolProps) {
  const [open, setOpen] = useState(false)
  const [dropMode, setDropMode] = useState(false)
  const [pins, setPins] = useState<Pin[]>([])
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const dropModeRef = useRef(dropMode)
  dropModeRef.current = dropMode

  // Load persisted pins once.
  useEffect(() => {
    setPins(listPins())
  }, [])

  // Keep the on-map markers in sync with the pin list.
  useEffect(() => {
    const existing = markersRef.current
    const seen = new Set<string>()

    for (const pin of pins) {
      seen.add(pin.id)
      let marker = existing.get(pin.id)
      if (!marker) {
        marker = new maplibregl.Marker({
          element: createPinElement(),
          anchor: 'bottom',
          draggable: true,
        })
          .setLngLat([pin.lng, pin.lat])
          .setPopup(new maplibregl.Popup({ offset: 28, closeButton: false }))
          .addTo(map)

        marker.on('dragend', () => {
          const m = markersRef.current.get(pin.id)
          if (!m) return
          const { lng, lat } = m.getLngLat()
          setPins(updatePinPosition(pin.id, lng, lat))
        })
        existing.set(pin.id, marker)
      } else {
        marker.setLngLat([pin.lng, pin.lat])
      }
      marker.getPopup()?.setText(pin.name)
    }

    // Remove markers whose pins are gone.
    for (const [id, marker] of existing) {
      if (!seen.has(id)) {
        marker.remove()
        existing.delete(id)
      }
    }
  }, [map, pins])

  // Tear down all markers on unmount.
  useEffect(() => {
    const markers = markersRef.current
    return () => {
      for (const marker of markers.values()) marker.remove()
      markers.clear()
    }
  }, [])

  // Drop a pin on map tap while placement is armed.
  useEffect(() => {
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!dropModeRef.current) return
      const next = addPin(`Pin ${listPins().length + 1}`, e.lngLat.lng, e.lngLat.lat)
      setPins(next)
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  // Crosshair cursor while arming placement.
  useEffect(() => {
    if (!dropMode) return
    const canvas = map.getCanvas()
    const prev = canvas.style.cursor
    canvas.style.cursor = 'crosshair'
    return () => {
      canvas.style.cursor = prev
    }
  }, [map, dropMode])

  const flyTo = (pin: Pin) => {
    map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 14) })
    markersRef.current.get(pin.id)?.togglePopup()
  }

  const onRename = (pin: Pin) => {
    const name = window.prompt('Rename pin', pin.name)
    if (name === null) return
    setPins(renamePin(pin.id, name))
  }

  const onDelete = (pin: Pin) => {
    if (!window.confirm(`Delete "${pin.name}"?`)) return
    setPins(deletePin(pin.id))
  }

  const onExport = () => {
    if (pins.length === 0) return
    downloadWaypointGpx(pins.map((p) => ({ lng: p.lng, lat: p.lat, name: p.name })))
  }

  const toggleOpen = () => {
    setOpen((o) => {
      const next = !o
      if (!next) setDropMode(false)
      return next
    })
  }

  return (
    <div className="pin-tool">
      <button
        type="button"
        className={`pin-btn${open ? ' is-open' : ''}`}
        onClick={toggleOpen}
        title="Pins"
        aria-label="Pins"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"
          />
          <circle cx="12" cy="9" r="2.6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {open && (
        <div className="pin-panel" role="dialog" aria-label="Pins">
          <div className="pin-panel-head">
            <span className="pin-panel-title">Pins</span>
            <span className="pin-panel-hint">
              {dropMode ? 'Tap the map to drop' : 'Drag a pin to move it'}
            </span>
          </div>

          <div className="pin-actions">
            <button
              type="button"
              className={`pin-drop${dropMode ? ' is-armed' : ''}`}
              onClick={() => setDropMode((d) => !d)}
            >
              {dropMode ? 'Placing…' : '+ Drop pin'}
            </button>
            <button type="button" onClick={onExport} disabled={pins.length === 0}>
              Export
            </button>
          </div>

          {pins.length === 0 ? (
            <div className="pin-empty">
              No pins yet. Tap <strong>Drop pin</strong>, then tap the map.
            </div>
          ) : (
            <ul className="pin-list">
              {pins.map((p) => (
                <li key={p.id} className="pin-item">
                  <button
                    type="button"
                    className="pin-load"
                    onClick={() => flyTo(p)}
                    title="Go to pin"
                  >
                    <span className="pin-name">{p.name}</span>
                    <span className="pin-meta">
                      {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pin-icon"
                    onClick={() => onRename(p)}
                    title="Rename"
                    aria-label={`Rename ${p.name}`}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="pin-icon"
                    onClick={() => onDelete(p)}
                    title="Delete"
                    aria-label={`Delete ${p.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
