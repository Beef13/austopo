import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { geocode, type GeocodeResult } from '../lib/geocode'

type SearchBarProps = {
  map: maplibregl.Map
}

const DEBOUNCE_MS = 600 // respect Nominatim's ~1 req/sec policy

export default function SearchBar({ map }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Debounced geocoding whenever the query changes.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      setError(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(false)
    const timer = setTimeout(async () => {
      try {
        const found = await geocode(trimmed, controller.signal)
        setResults(found)
        setOpen(true)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError(true)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const selectResult = (result: GeocodeResult) => {
    setQuery(result.label.split(',')[0])
    setOpen(false)

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#c0392b' })
    }
    markerRef.current.setLngLat([result.lon, result.lat]).addTo(map)

    if (result.bbox) {
      map.fitBounds(
        [
          [result.bbox[0], result.bbox[1]],
          [result.bbox[2], result.bbox[3]],
        ],
        { padding: 80, maxZoom: 15, duration: 1000 },
      )
    } else {
      map.flyTo({ center: [result.lon, result.lat], zoom: 13, duration: 1000 })
    }
  }

  const clear = () => {
    setQuery('')
    setResults([])
    setOpen(false)
    markerRef.current?.remove()
    markerRef.current = null
  }

  return (
    <div className="search" ref={containerRef}>
      <div className="search-input-wrap">
        <svg className="search-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 4a6 6 0 1 0 3.87 10.59l4.77 4.77a1 1 0 0 0 1.42-1.42l-4.77-4.77A6 6 0 0 0 10 4Zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
          />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder="Search places in Australia"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          aria-label="Search places in Australia"
        />
        {loading && <span className="search-spinner" aria-hidden="true" />}
        {query && !loading && (
          <button type="button" className="search-clear" onClick={clear} aria-label="Clear search">
            &times;
          </button>
        )}
      </div>

      {open && (results.length > 0 || error) && (
        <ul className="search-results">
          {error && <li className="search-message">Search failed. Try again.</li>}
          {results.map((result) => (
            <li key={result.id}>
              <button type="button" onClick={() => selectResult(result)}>
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
