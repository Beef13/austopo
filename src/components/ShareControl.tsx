import { useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { BaseLayerId } from '../lib/mapStyle'
import { buildShareUrl } from '../lib/urlState'

type ShareControlProps = {
  map: maplibregl.Map
  layer: BaseLayerId
}

// Shares a link to the exact current view (centre, zoom, layer). Uses the
// native share sheet where available, otherwise copies the link to clipboard.
export default function ShareControl({ map, layer }: ShareControlProps) {
  const [feedback, setFeedback] = useState<'idle' | 'copied' | 'shared'>('idle')

  const share = async () => {
    const center = map.getCenter()
    const url = buildShareUrl({
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom(),
      layer,
    })

    if (navigator.share) {
      try {
        await navigator.share({ title: 'AusTopo location', url })
        setFeedback('shared')
        setTimeout(() => setFeedback('idle'), 1200)
        return
      } catch {
        // User cancelled or share failed; fall back to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setFeedback('copied')
      setTimeout(() => setFeedback('idle'), 1200)
    } catch {
      // Clipboard unavailable; nothing more we can do gracefully.
    }
  }

  const label =
    feedback === 'copied'
      ? 'Link copied'
      : feedback === 'shared'
        ? 'Shared'
        : 'Share this location'

  return (
    <button
      type="button"
      className="share-btn"
      onClick={share}
      title={label}
      aria-label={label}
    >
      {feedback === 'idle' ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18 16a3 3 0 0 0-2.24 1.01l-6.09-3.05a3.03 3.03 0 0 0 0-1.92l6.09-3.05a3 3 0 1 0-.76-1.79l-6.09 3.05a3 3 0 1 0 0 5.5l6.09 3.05A3 3 0 1 0 18 16Z"
          />
        </svg>
      ) : (
        <span className="share-feedback">{label}</span>
      )}
    </button>
  )
}
