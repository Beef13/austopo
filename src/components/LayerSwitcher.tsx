import { useEffect } from 'react'
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
]

export default function LayerSwitcher({ map, active, onChange }: LayerSwitcherProps) {
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
    </div>
  )
}
