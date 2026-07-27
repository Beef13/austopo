import type { LngLat } from './geo'

// Simple on-device persistence for routes using localStorage. Routes are tiny
// (arrays of coordinates), so this is plenty for the foreseeable future.

const STORAGE_KEY = 'austopo.routes.v1'

export type SavedRoute = {
  id: string
  name: string
  createdAt: number
  waypoints: LngLat[]
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function listRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedRoute[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r) => r && Array.isArray(r.waypoints) && r.waypoints.length >= 2)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function persist(routes: SavedRoute[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes))
  } catch {
    // Storage unavailable (private mode / quota) — fail silently.
  }
}

export function saveRoute(name: string, waypoints: LngLat[]): SavedRoute[] {
  const route: SavedRoute = {
    id: makeId(),
    name: name.trim() || 'Untitled route',
    createdAt: Date.now(),
    waypoints,
  }
  const next = [route, ...listRoutes()]
  persist(next)
  return next
}

export function renameRoute(id: string, name: string): SavedRoute[] {
  const next = listRoutes().map((r) =>
    r.id === id ? { ...r, name: name.trim() || r.name } : r,
  )
  persist(next)
  return next
}

export function deleteRoute(id: string): SavedRoute[] {
  const next = listRoutes().filter((r) => r.id !== id)
  persist(next)
  return next
}
