import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'

type LocateControlProps = {
  map: maplibregl.Map
}

type Status = 'idle' | 'locating' | 'active' | 'error'

// Builds the little pulsing blue dot used to mark the user's position.
function createLocationMarkerElement(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'user-location-marker'
  el.innerHTML = '<span class="user-location-pulse"></span><span class="user-location-dot"></span>'
  return el
}

export default function LocateControl({ map }: LocateControlProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [following, setFollowing] = useState(false)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const followingRef = useRef(following)
  followingRef.current = following

  // Stop auto-following as soon as the user drags the map themselves.
  useEffect(() => {
    const stopFollow = () => setFollowing(false)
    map.on('dragstart', stopFollow)
    return () => {
      map.off('dragstart', stopFollow)
    }
  }, [map])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      markerRef.current?.remove()
    }
  }, [])

  const updatePosition = (position: GeolocationPosition) => {
    const lngLat: [number, number] = [
      position.coords.longitude,
      position.coords.latitude,
    ]

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({
        element: createLocationMarkerElement(),
      })
        .setLngLat(lngLat)
        .addTo(map)
    } else {
      markerRef.current.setLngLat(lngLat)
    }

    setStatus('active')

    if (followingRef.current) {
      map.easeTo({
        center: lngLat,
        zoom: Math.max(map.getZoom(), 13),
        duration: 800,
      })
    }
  }

  const handleClick = () => {
    if (!('geolocation' in navigator)) {
      setStatus('error')
      return
    }

    // Already tracking: just re-center and re-enable follow.
    if (watchIdRef.current !== null && markerRef.current) {
      setFollowing(true)
      map.easeTo({
        center: markerRef.current.getLngLat(),
        zoom: Math.max(map.getZoom(), 13),
        duration: 800,
      })
      return
    }

    setStatus('locating')
    setFollowing(true)
    watchIdRef.current = navigator.geolocation.watchPosition(
      updatePosition,
      () => setStatus('error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
  }

  const title =
    status === 'error'
      ? 'Location unavailable — check permissions'
      : following
        ? 'Following your location'
        : 'Show my location'

  return (
    <button
      type="button"
      className={`locate-btn${following ? ' is-following' : ''}${status === 'error' ? ' is-error' : ''}`}
      onClick={handleClick}
      title={title}
      aria-label={title}
    >
      {status === 'locating' ? (
        <span className="locate-spinner" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3a1 1 0 0 1 0 2h-2.06A7 7 0 0 1 13 18.93V21a1 1 0 0 1-2 0v-2.07A7 7 0 0 1 5.06 13H3a1 1 0 0 1 0-2h2.06A7 7 0 0 1 11 5.07V3a1 1 0 0 1 2 0v2.07A7 7 0 0 1 18.94 11H21ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
          />
        </svg>
      )}
    </button>
  )
}
