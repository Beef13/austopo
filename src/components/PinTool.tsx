import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { downloadWaypointGpx } from '../lib/gpx'
import {
  addPin,
  deletePin,
  listPins,
  updatePin,
  updatePinPosition,
  type Pin,
} from '../lib/savedPins'
import {
  PIN_TYPES,
  pinMarkerSvg,
  pinTypeMeta,
  type PinType,
} from '../lib/pinTypes'

type PinToolProps = {
  map: maplibregl.Map
  open: boolean
  onToggle: () => void
}

function createPinElement(type: PinType): HTMLElement {
  const el = document.createElement('div')
  el.className = 'map-pin'
  el.dataset.type = type
  el.innerHTML = pinMarkerSvg(type)
  return el
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function popupHtml(pin: Pin): string {
  const meta = pinTypeMeta(pin.type)
  const notes = pin.notes?.trim()
    ? `<div class="pin-popup-notes">${escapeHtml(pin.notes)}</div>`
    : ''
  return `<div class="pin-popup">
    <div class="pin-popup-title">${escapeHtml(pin.name)}</div>
    <div class="pin-popup-type">${escapeHtml(meta.label)}</div>
    ${notes}
    <div class="pin-popup-coord">${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}</div>
  </div>`
}

export default function PinTool({ map, open, onToggle }: PinToolProps) {
  const [dropMode, setDropMode] = useState(false)
  const [pins, setPins] = useState<Pin[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
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
          element: createPinElement(pin.type),
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
        // Re-render the glyph if the pin's type changed.
        const el = marker.getElement()
        if (el.dataset.type !== pin.type) {
          el.dataset.type = pin.type
          el.innerHTML = pinMarkerSvg(pin.type)
        }
      }
      marker.getPopup()?.setHTML(popupHtml(pin))
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

  // Drop a pin on map tap while placement is armed, then open its editor.
  useEffect(() => {
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!dropModeRef.current) return
      const next = addPin(`Pin ${listPins().length + 1}`, e.lngLat.lng, e.lngLat.lat)
      setPins(next)
      setEditingId(next[0]?.id ?? null)
      setDropMode(false)
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

  const onDelete = (pin: Pin) => {
    if (!window.confirm(`Delete "${pin.name}"?`)) return
    if (editingId === pin.id) setEditingId(null)
    setPins(deletePin(pin.id))
  }

  const onExport = () => {
    if (pins.length === 0) return
    downloadWaypointGpx(
      pins.map((p) => ({
        lng: p.lng,
        lat: p.lat,
        name: p.name,
        desc: p.notes,
        sym: pinTypeMeta(p.type).sym,
      })),
    )
  }

  // When minimised, drop the transient arming / editing states but keep the pins.
  useEffect(() => {
    if (!open) {
      setDropMode(false)
      setEditingId(null)
    }
  }, [open])

  return (
    <div className="pin-tool">
      <button
        type="button"
        className={`pin-btn${open ? ' is-open' : ''}`}
        onClick={onToggle}
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

      <div
        className={`pin-panel${open ? ' is-open' : ' is-closed'}`}
        role="dialog"
        aria-label="Pins"
        aria-hidden={!open}
      >
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
              {pins.map((p) =>
                editingId === p.id ? (
                  <li key={p.id} className="pin-item is-editing">
                    <PinEditor
                      pin={p}
                      onSave={(edit) => {
                        setPins(updatePin(p.id, edit))
                        setEditingId(null)
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <li key={p.id} className="pin-item">
                    <span
                      className="pin-type-icon"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: pinMarkerSvg(p.type, 22) }}
                    />
                    <button
                      type="button"
                      className="pin-load"
                      onClick={() => flyTo(p)}
                      title="Go to pin"
                    >
                      <span className="pin-name">{p.name}</span>
                      <span className="pin-meta">
                        {pinTypeMeta(p.type).label}
                        {p.notes?.trim() ? ` · ${p.notes.trim()}` : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pin-icon"
                      onClick={() => setEditingId(p.id)}
                      title="Edit"
                      aria-label={`Edit ${p.name}`}
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
                ),
              )}
            </ul>
          )}
      </div>
    </div>
  )
}

type PinEditorProps = {
  pin: Pin
  onSave: (edit: { name: string; type: PinType; notes: string }) => void
  onCancel: () => void
}

function PinEditor({ pin, onSave, onCancel }: PinEditorProps) {
  const [name, setName] = useState(pin.name)
  const [type, setType] = useState<PinType>(pin.type)
  const [notes, setNotes] = useState(pin.notes ?? '')

  return (
    <form
      className="pin-editor"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ name, type, notes })
      }}
    >
      <input
        className="pin-editor-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        aria-label="Pin name"
        autoFocus
      />

      <div className="pin-type-grid" role="radiogroup" aria-label="Pin type">
        {PIN_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pin-type-chip${type === t.id ? ' is-active' : ''}`}
            onClick={() => setType(t.id)}
            role="radio"
            aria-checked={type === t.id}
            title={t.label}
          >
            <span
              className="pin-type-chip-icon"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: pinMarkerSvg(t.id, 20) }}
            />
            <span className="pin-type-chip-label">{t.label}</span>
          </button>
        ))}
      </div>

      <textarea
        className="pin-editor-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        aria-label="Pin notes"
        rows={2}
      />

      <div className="pin-editor-actions">
        <button type="button" className="pin-editor-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="pin-editor-save">
          Save
        </button>
      </div>
    </form>
  )
}
