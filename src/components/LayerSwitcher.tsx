import { useEffect, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { BaseLayerId } from '../lib/mapStyle'

type LayerSwitcherProps = {
  map: maplibregl.Map
  active: BaseLayerId
  onChange: (id: BaseLayerId) => void
}

const OPTIONS: { id: BaseLayerId; label: string }[] = [
  { id: 'opentopomap', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'gatopo', label: 'GA Topo' },
]

export default function LayerSwitcher({ map, active, onChange }: LayerSwitcherProps) {
  const [relief, setRelief] = useState(false)

  // Keep the map's layer visibility in sync with the active base layer
  // (also applies the initial layer when restored from a shared URL).
  useEffect(() => {
    for (const opt of OPTIONS) {
      map.setLayoutProperty(
        opt.id,
        'visibility',
        opt.id === active ? 'visible' : 'none',
      )
    }
  }, [map, active])

  // Toggle the hillshade (relief) overlay independently of the base layer.
  useEffect(() => {
    if (!map.getLayer('hillshade')) return
    map.setLayoutProperty('hillshade', 'visibility', relief ? 'visible' : 'none')
  }, [map, relief])

  return (
    <div className="layer-switcher" role="group" aria-label="Base map layer">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`layer-option${active === opt.id ? ' is-active' : ''}`}
          onClick={() => onChange(opt.id)}
          aria-pressed={active === opt.id}
        >
          {opt.label}
        </button>
      ))}
      <span className="layer-divider" aria-hidden="true" />
      <button
        type="button"
        className={`layer-option${relief ? ' is-active' : ''}`}
        onClick={() => setRelief((r) => !r)}
        aria-pressed={relief}
        title="Hillshade relief overlay"
      >
        Relief
      </button>
    </div>
  )
}
