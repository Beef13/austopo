import { useEffect, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import {
  BASE_LAYER_OPTIONS,
  type BaseLayerId,
  type BaseLayerMeta,
} from '../lib/mapStyle'

type LayerSwitcherProps = {
  map: maplibregl.Map
  active: BaseLayerId
  onChange: (id: BaseLayerId) => void
}

const OPTIONS = BASE_LAYER_OPTIONS

export default function LayerSwitcher({ map, active, onChange }: LayerSwitcherProps) {
  const [relief, setRelief] = useState(false)

  // Keep the map's layer visibility in sync with the active base layer (also
  // applies the initial layer when restored from a shared URL). A base can be a
  // single raster layer or a whole group of vector layers (MapTiler), so we
  // toggle by the `base` marker on each layer's metadata and restore each
  // layer's original visibility (`ov`) when its base is selected.
  useEffect(() => {
    const layers = map.getStyle()?.layers ?? []
    for (const layer of layers) {
      const meta = layer.metadata as Partial<BaseLayerMeta> | undefined
      if (!meta?.base) continue
      map.setLayoutProperty(
        layer.id,
        'visibility',
        meta.base === active ? meta.ov ?? 'visible' : 'none',
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
