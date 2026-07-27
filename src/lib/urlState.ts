import { BASE_LAYER_IDS, type BaseLayerId } from './mapStyle'

// URL query state lets a view be shared and restored, e.g.
//   ?lat=-33.8568&lng=151.2153&z=15&layer=satellite

export type ViewState = {
  lat?: number
  lng?: number
  zoom?: number
  layer?: BaseLayerId
}

export function readViewFromUrl(search = window.location.search): ViewState {
  const params = new URLSearchParams(search)
  const lat = parseFloat(params.get('lat') ?? '')
  const lng = parseFloat(params.get('lng') ?? '')
  const zoom = parseFloat(params.get('z') ?? '')
  const rawLayer = params.get('layer')
  const layer: BaseLayerId | undefined =
    rawLayer && (BASE_LAYER_IDS as string[]).includes(rawLayer)
      ? (rawLayer as BaseLayerId)
      : undefined

  return {
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    zoom: Number.isFinite(zoom) ? zoom : undefined,
    layer,
  }
}

export function buildViewQuery(view: Required<Omit<ViewState, 'layer'>> & { layer: BaseLayerId }): string {
  const params = new URLSearchParams({
    lat: view.lat.toFixed(5),
    lng: view.lng.toFixed(5),
    z: view.zoom.toFixed(2),
    layer: view.layer,
  })
  return `?${params.toString()}`
}

export function buildShareUrl(view: Required<Omit<ViewState, 'layer'>> & { layer: BaseLayerId }): string {
  return `${window.location.origin}${window.location.pathname}${buildViewQuery(view)}`
}
