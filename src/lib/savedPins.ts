// On-device persistence for user-dropped pins (points of interest) using
// localStorage. Pins are tiny, so this scales fine for personal use.

import type { PinType } from './pinTypes'

const STORAGE_KEY = 'austopo.pins.v1'

export type Pin = {
  id: string
  name: string
  lng: number
  lat: number
  type: PinType
  notes: string
  createdAt: number
}

// Fields the user can edit after a pin is dropped.
export type PinEdit = Partial<Pick<Pin, 'name' | 'type' | 'notes'>>

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function listPins(): Pin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Pin[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (p) =>
          p &&
          typeof p.lng === 'number' &&
          typeof p.lat === 'number' &&
          Number.isFinite(p.lng) &&
          Number.isFinite(p.lat),
      )
      // Backfill type/notes for pins saved before those fields existed.
      .map((p) => ({
        ...p,
        type: (p.type ?? 'generic') as PinType,
        notes: typeof p.notes === 'string' ? p.notes : '',
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function persist(pins: Pin[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins))
  } catch {
    // Storage unavailable (private mode / quota) — fail silently.
  }
}

export function addPin(
  name: string,
  lng: number,
  lat: number,
  type: PinType = 'generic',
): Pin[] {
  const pin: Pin = {
    id: makeId(),
    name: name.trim() || 'Untitled pin',
    lng,
    lat,
    type,
    notes: '',
    createdAt: Date.now(),
  }
  const next = [pin, ...listPins()]
  persist(next)
  return next
}

export function updatePin(id: string, edit: PinEdit): Pin[] {
  const next = listPins().map((p) => {
    if (p.id !== id) return p
    return {
      ...p,
      ...edit,
      name: edit.name !== undefined ? edit.name.trim() || p.name : p.name,
    }
  })
  persist(next)
  return next
}

export function updatePinPosition(id: string, lng: number, lat: number): Pin[] {
  const next = listPins().map((p) => (p.id === id ? { ...p, lng, lat } : p))
  persist(next)
  return next
}

export function deletePin(id: string): Pin[] {
  const next = listPins().filter((p) => p.id !== id)
  persist(next)
  return next
}
