import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { formatDistance, haversine, type LngLat } from '../lib/geo'
import { downloadTrackGpx, type TrackPoint } from '../lib/gpx'
import { saveRoute } from '../lib/savedRoutes'

type TrackRecorderProps = {
  map: maplibregl.Map
}

const LINE_SOURCE = 'track'
const POS_SOURCE = 'track-pos'
const LINE_LAYER = 'track-line'
const POS_LAYER = 'track-pos-dot'

// Ignore fixes that barely moved (GPS jitter while standing still).
const MIN_STEP_M = 3

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export default function TrackRecorder({ map }: TrackRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [points, setPoints] = useState<TrackPoint[]>([])
  const [distance, setDistance] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const watchId = useRef<number | null>(null)
  const pointsRef = useRef<TrackPoint[]>([])
  const startTime = useRef(0)
  const firstFix = useRef(true)

  // Create the track line + position layers once.
  useEffect(() => {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    const setup = () => {
      if (!map.getSource(LINE_SOURCE)) {
        map.addSource(LINE_SOURCE, { type: 'geojson', data: empty })
        map.addLayer({
          id: LINE_LAYER,
          type: 'line',
          source: LINE_SOURCE,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#1e6fff', 'line-width': 4, 'line-opacity': 0.9 },
        })
      }
      if (!map.getSource(POS_SOURCE)) {
        map.addSource(POS_SOURCE, { type: 'geojson', data: empty })
        map.addLayer({
          id: POS_LAYER,
          type: 'circle',
          source: POS_SOURCE,
          paint: {
            'circle-radius': 7,
            'circle-color': '#1e6fff',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          },
        })
      }
    }
    setup()
    return () => {
      if (map.getLayer(POS_LAYER)) map.removeLayer(POS_LAYER)
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER)
      if (map.getSource(POS_SOURCE)) map.removeSource(POS_SOURCE)
      if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE)
    }
  }, [map])

  // Tick the elapsed-time display while recording.
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed(Date.now() - startTime.current), 1000)
    return () => clearInterval(id)
  }, [recording])

  // Clean up the geolocation watch on unmount.
  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [])

  const renderTrack = () => {
    const coords: LngLat[] = pointsRef.current.map((p) => [p.lng, p.lat])
    const line = map.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource | undefined
    line?.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    })
    const pos = map.getSource(POS_SOURCE) as maplibregl.GeoJSONSource | undefined
    const last = coords[coords.length - 1]
    pos?.setData({
      type: 'FeatureCollection',
      features: last
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: last }, properties: {} }]
        : [],
    })
  }

  const onPosition = (pos: GeolocationPosition) => {
    setError(null)
    const { longitude, latitude, altitude } = pos.coords
    const prev = pointsRef.current[pointsRef.current.length - 1]
    const here: LngLat = [longitude, latitude]
    if (prev) {
      const step = haversine([prev.lng, prev.lat], here)
      if (step < MIN_STEP_M) return
      setDistance((d) => d + step)
    }
    const point: TrackPoint = {
      lng: longitude,
      lat: latitude,
      ele: altitude ?? undefined,
      time: pos.timestamp,
    }
    pointsRef.current = [...pointsRef.current, point]
    setPoints(pointsRef.current)
    renderTrack()

    // Keep the current position on screen without fighting manual panning.
    if (firstFix.current) {
      firstFix.current = false
      map.easeTo({ center: here, zoom: Math.max(map.getZoom(), 15), duration: 600 })
    } else if (!map.getBounds().contains(here)) {
      map.easeTo({ center: here, duration: 600 })
    }
  }

  const onError = (err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      setError('Location permission denied')
      stop()
    } else {
      setError('Waiting for GPS signal…')
    }
  }

  const start = () => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation not supported')
      return
    }
    pointsRef.current = []
    firstFix.current = true
    setPoints([])
    setDistance(0)
    setElapsed(0)
    setError(null)
    startTime.current = Date.now()
    renderTrack()
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    })
    setRecording(true)
  }

  const stop = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    setRecording(false)
  }

  const discard = () => {
    pointsRef.current = []
    setPoints([])
    setDistance(0)
    setElapsed(0)
    setError(null)
    renderTrack()
  }

  const exportGpx = () => {
    if (points.length < 2) return
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    downloadTrackGpx(points, `austopo-track-${stamp}.gpx`)
  }

  const saveAsRoute = () => {
    if (points.length < 2) return
    const name = window.prompt('Save track as route — name', `Track ${formatDistance(distance)}`)
    if (name === null) return
    saveRoute(name, points.map((p) => [p.lng, p.lat] as LngLat))
    discard()
  }

  const hasTrack = points.length > 0
  const showPanel = recording || hasTrack

  return (
    <div className="track">
      <button
        type="button"
        className={`track-btn${recording ? ' is-recording' : ''}`}
        onClick={recording ? stop : start}
        title={recording ? 'Stop recording' : 'Record a track'}
        aria-label={recording ? 'Stop recording' : 'Record a track'}
        aria-pressed={recording}
      >
        <span className={recording ? 'track-icon-stop' : 'track-icon-rec'} />
      </button>

      {showPanel && (
        <div className="track-panel" role="dialog" aria-label="Track recorder">
          <div className="track-panel-head">
            <span className="track-panel-title">
              {recording && <span className="track-rec-dot" />}
              {recording ? 'Recording' : 'Track'}
            </span>
          </div>

          <div className="track-stats">
            <div className="track-stat">
              <span className="track-stat-val">{formatDistance(distance)}</span>
              <span className="track-stat-key">distance</span>
            </div>
            <div className="track-stat">
              <span className="track-stat-val">{formatDuration(elapsed)}</span>
              <span className="track-stat-key">time</span>
            </div>
            <div className="track-stat">
              <span className="track-stat-val">{points.length}</span>
              <span className="track-stat-key">points</span>
            </div>
          </div>

          {error && <div className="track-error">{error}</div>}

          <div className="track-actions">
            {recording ? (
              <button type="button" className="track-stop-btn" onClick={stop}>
                Stop
              </button>
            ) : (
              <>
                <button type="button" onClick={saveAsRoute} disabled={points.length < 2}>
                  Save
                </button>
                <button type="button" onClick={exportGpx} disabled={points.length < 2}>
                  Export
                </button>
                <button type="button" onClick={discard}>
                  Discard
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
