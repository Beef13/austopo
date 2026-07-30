import type { BRouterProfile } from './routing'

// The activities the route planner supports. Each maps to a BRouter routing
// profile (used when snapping to paths) plus a flat pace and climb rate used
// for the Naismith-style time estimate. Foot activities share the
// "hiking-mountain" profile (so switching between them is a cache hit and
// doesn't re-route); only the time estimate differs.
export type ActivityId = 'hiking' | 'walking' | 'running' | 'cycling'

export type Activity = {
  id: ActivityId
  label: string
  profile: BRouterProfile
  speedKmh: number
  climbMetresPerHour: number
}

export const ACTIVITIES: Activity[] = [
  {
    id: 'hiking',
    label: 'Hiking',
    profile: 'hiking-mountain',
    speedKmh: 4.5,
    climbMetresPerHour: 600,
  },
  {
    id: 'walking',
    label: 'Walking',
    profile: 'hiking-mountain',
    speedKmh: 5,
    climbMetresPerHour: 600,
  },
  {
    id: 'running',
    label: 'Trail run',
    profile: 'hiking-mountain',
    speedKmh: 8.5,
    climbMetresPerHour: 900,
  },
  {
    id: 'cycling',
    label: 'Cycling',
    profile: 'trekking',
    speedKmh: 15,
    climbMetresPerHour: 500,
  },
]

export function getActivity(id: ActivityId): Activity {
  return ACTIVITIES.find((a) => a.id === id) ?? ACTIVITIES[0]
}

// Naismith's rule (generalised per activity): flat travel time from distance
// plus a climbing penalty from total ascent. Descent is ignored, matching the
// classic baseline. Returns seconds.
export function estimateTimeSeconds(
  distanceM: number,
  ascentM: number,
  activity: Activity,
): number {
  if (distanceM <= 0) return 0
  const flatHours = distanceM / 1000 / activity.speedKmh
  const climbHours = Math.max(0, ascentM) / activity.climbMetresPerHour
  return (flatHours + climbHours) * 3600
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0 min'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
