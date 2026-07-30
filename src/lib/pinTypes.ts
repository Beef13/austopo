// Categories for dropped pins (points of interest). Each has a colour, a small
// white glyph drawn inside the map marker, and a GPX <sym> name so exported
// waypoints show a sensible icon in other apps (Garmin/OsmAnd conventions).

export type PinType =
  | 'generic'
  | 'summit'
  | 'water'
  | 'camp'
  | 'view'
  | 'parking'
  | 'hazard'

export type PinTypeMeta = {
  id: PinType
  label: string
  color: string
  // SVG markup placed inside the teardrop, centred around (12,9).
  glyph: string
  // GPX <sym> name for export.
  sym: string
}

// Glyphs are authored against a 24x24 viewBox with the pin's "eye" at (12,9).
export const PIN_TYPES: PinTypeMeta[] = [
  {
    id: 'generic',
    label: 'Point',
    color: '#1565c0',
    glyph: '<circle cx="12" cy="9" r="2.6" fill="#fff"/>',
    sym: 'Waypoint',
  },
  {
    id: 'summit',
    label: 'Summit',
    color: '#6d4c41',
    glyph:
      '<path d="M8 11.2l4-4.6 4 4.6" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    sym: 'Summit',
  },
  {
    id: 'water',
    label: 'Water',
    color: '#0288d1',
    glyph:
      '<path d="M12 5.9c1.7 2.1 2.6 3.4 2.6 4.6a2.6 2.6 0 0 1-5.2 0c0-1.2.9-2.5 2.6-4.6z" fill="#fff"/>',
    sym: 'Drinking Water',
  },
  {
    id: 'camp',
    label: 'Campsite',
    color: '#2e7d32',
    glyph: '<path d="M12 5.9l3.8 6.4h-7.6z" fill="#fff"/>',
    sym: 'Campground',
  },
  {
    id: 'view',
    label: 'Viewpoint',
    color: '#7b1fa2',
    glyph:
      '<path d="M7.4 9s1.9-2.6 4.6-2.6S16.6 9 16.6 9s-1.9 2.6-4.6 2.6S7.4 9 7.4 9z" fill="#fff"/><circle cx="12" cy="9" r="1.1" fill="#7b1fa2"/>',
    sym: 'Scenic Area',
  },
  {
    id: 'parking',
    label: 'Parking',
    color: '#455a64',
    glyph:
      '<text x="12" y="11.7" text-anchor="middle" font-size="7.5" font-weight="700" font-family="Arial, sans-serif" fill="#fff">P</text>',
    sym: 'Parking Area',
  },
  {
    id: 'hazard',
    label: 'Hazard',
    color: '#d84315',
    glyph:
      '<path d="M12 5.9l3.8 6.4h-7.6z" fill="#fff"/><rect x="11.4" y="8.4" width="1.2" height="2.2" rx="0.5" fill="#d84315"/><rect x="11.4" y="11.1" width="1.2" height="1.1" rx="0.5" fill="#d84315"/>',
    sym: 'Danger Area',
  },
]

const BY_ID = new Map(PIN_TYPES.map((t) => [t.id, t]))

export function pinTypeMeta(type: PinType | undefined): PinTypeMeta {
  return BY_ID.get(type ?? 'generic') ?? PIN_TYPES[0]
}

// The teardrop marker SVG for a given type, coloured and glyphed.
export function pinMarkerSvg(type: PinType | undefined, size = 30): string {
  const meta = pinTypeMeta(type)
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z"
      fill="${meta.color}" stroke="#fff" stroke-width="1.5"/>
    ${meta.glyph}
  </svg>`
}
