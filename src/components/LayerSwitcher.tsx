import { useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { BaseLayerId } from '../lib/mapStyle'

type LayerSwitcherProps = {
  map: maplibregl.Map
}

const OPTIONS: { id: BaseLayerId; label: string }[] = [
  { id: 'opentopomap', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
]

export default function LayerSwitcher({ map }: LayerSwitcherProps) {
  const [active, setActive] = useState<BaseLayerId>('opentopomap')

  const select = (id: BaseLayerId) => {
    if (id === active) return
    for (const opt of OPTIONS) {
      map.setLayoutProperty(
        opt.id,
        'visibility',
        opt.id === id ? 'visible' : 'none',
      )
    }
    setActive(id)
  }

  return (
    <div className="layer-switcher" role="group" aria-label="Base map layer">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`layer-option${active === opt.id ? ' is-active' : ''}`}
          onClick={() => select(opt.id)}
          aria-pressed={active === opt.id}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
