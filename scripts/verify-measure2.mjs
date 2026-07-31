import { chromium } from 'playwright'

// Verifies (1) tapping on an existing measure line inserts a point at that spot
// (not appended to the end) and (2) the circle mode: centre+edge draws a circle,
// radius/diameter toggle, and drag behaviour (edge resizes, centre translates).
const APP_URL =
  process.env.URL || 'http://localhost:5216/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForFunction(() => {
  const el = document.querySelector('.measure-panel')
  return el && getComputedStyle(el).visibility === 'hidden'
})
await page.waitForTimeout(3000)

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(250)
}
const drag = async (x1, y1, x2, y2) => {
  await page.mouse.move(box.x + x1, box.y + y1)
  await page.mouse.down()
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
const firstStat = () =>
  page.evaluate(() => document.querySelector('.measure-stat-val')?.textContent ?? '')
const ptCount = () =>
  page.evaluate(() =>
    window.__map
      ? window.__map.queryRenderedFeatures({ layers: ['measure-points'] }).length
      : -1,
  )
const parseM = (s) => {
  const n = parseFloat(s)
  if (Number.isNaN(n)) return NaN
  return /km/.test(s) ? n * 1000 : n
}

await page.click('.measure-btn', { force: true })
await page.waitForTimeout(300)

// --- Insert-on-line (distance mode) ---
await tap(250, 300) // A
await tap(650, 300) // B
const distAB = parseM(await firstStat())
await tap(450, 300) // tap the middle of the A-B line
const distAfter = parseM(await firstStat())
const countAfterInsert = await ptCount()
// If inserted between A and B the total length barely changes; if appended
// (A-B-mid) it would jump by ~half again.
const inserted = countAfterInsert === 3 && Math.abs(distAfter - distAB) / distAB < 0.1

await page.click('.measure-panel .measure-actions button:nth-child(2)') // Clear

// --- Circle mode ---
await page.click('.measure-modes button:nth-child(3)', { force: true }) // Circle
await page.waitForTimeout(200)
await tap(400, 450) // centre only

// Rubber-band preview: moving the mouse (no click yet) should grow the circle.
await page.mouse.move(box.x + 520, box.y + 450, { steps: 6 })
await page.waitForTimeout(200)
const previewStat = await firstStat()
const radiusM = parseM(previewStat)
const previewRendered = await page.evaluate(() => {
  const m = window.__map
  return {
    fill: m.queryRenderedFeatures({ layers: ['measure-fill'] }).length,
    guide: m.queryRenderedFeatures({ layers: ['measure-guide'] }).length,
  }
})
const previewWorks =
  previewRendered.fill > 0 && previewRendered.guide > 0 && radiusM > 0

// Second click commits the circle at that spot.
await tap(520, 450)
await page.waitForTimeout(200)
const radiusText = await firstStat()
const circleRendered = await page.evaluate(() => {
  const m = window.__map
  return {
    fill: m.queryRenderedFeatures({ layers: ['measure-fill'] }).length,
    line: m.queryRenderedFeatures({ layers: ['measure-line'] }).length,
    guide: m.queryRenderedFeatures({ layers: ['measure-guide'] }).length,
  }
})

// After committing, moving the mouse must NOT resize the circle (it's locked).
await page.mouse.move(box.x + 640, box.y + 450, { steps: 6 })
await page.waitForTimeout(200)
const rAfterMoveM = parseM(await firstStat())
const committed = Math.abs(rAfterMoveM - radiusM) / radiusM < 0.03

// Radius -> Diameter should double the primary value.
await page.click('.measure-submodes button:nth-child(2)') // Diameter
await page.waitForTimeout(150)
const diaM = parseM(await firstStat())
const doubles = Math.abs(diaM - 2 * radiusM) / (2 * radiusM) < 0.02

// The diameter guide must run through the centre point (min pixel distance from
// the centre to the guide polyline ~0, and the polyline has the centre vertex).
const diaGuide = await page.evaluate(() => {
  const m = window.__map
  // Read the true source geometry (queryRenderedFeatures drops collinear points).
  const src = m.getSource('measure')
  const data = (src.serialize && src.serialize().data) || src._data
  const feats = data.features
  const guide = feats.find((f) => f.properties && f.properties.kind === 'guide')
  const center = feats.find(
    (f) => f.geometry.type === 'Point' && f.properties && f.properties.role === 'center',
  )
  if (!guide || !center) return { ok: false }
  const c = m.project(center.geometry.coordinates)
  const coords = guide.geometry.coordinates
  let min = Infinity
  for (let i = 0; i < coords.length - 1; i++) {
    const a = m.project(coords[i])
    const b = m.project(coords[i + 1])
    const abx = b.x - a.x
    const aby = b.y - a.y
    const l2 = abx * abx + aby * aby || 1
    let t = ((c.x - a.x) * abx + (c.y - a.y) * aby) / l2
    t = Math.max(0, Math.min(1, t))
    const dx = a.x + t * abx - c.x
    const dy = a.y + t * aby - c.y
    min = Math.min(min, Math.hypot(dx, dy))
  }
  return { ok: true, min, n: coords.length }
})
const diaThroughCenter = diaGuide.ok && diaGuide.n === 3 && diaGuide.min < 2

// Back to radius; grabbing the committed edge handle and dragging re-edits it.
await page.click('.measure-submodes button:nth-child(1)') // Radius
await page.waitForTimeout(150)
const rBeforeEdge = parseM(await firstStat())
await drag(520, 450, 620, 450) // drag edge outward
const rAfterEdge = parseM(await firstStat())
const edgeResizes = rAfterEdge > rBeforeEdge * 1.2

// Dragging the centre translates the circle: radius unchanged.
await drag(400, 450, 440, 470)
const rAfterCenter = parseM(await firstStat())
const centerKeepsRadius = Math.abs(rAfterCenter - rAfterEdge) / rAfterEdge < 0.06

await browser.close()

const out = {
  distAB,
  distAfter,
  countAfterInsert,
  inserted,
  previewStat,
  previewRendered,
  previewWorks,
  radiusText,
  radiusM,
  circleRendered,
  rAfterMoveM,
  committed,
  diaM,
  doubles,
  diaGuide,
  diaThroughCenter,
  rBeforeEdge,
  rAfterEdge,
  edgeResizes,
  rAfterCenter,
  centerKeepsRadius,
  errors,
}
console.log(JSON.stringify(out, null, 2))

const ok =
  inserted &&
  previewWorks &&
  circleRendered.fill > 0 &&
  circleRendered.line > 0 &&
  circleRendered.guide > 0 &&
  radiusM > 0 &&
  committed &&
  doubles &&
  diaThroughCenter &&
  edgeResizes &&
  centerKeepsRadius &&
  errors.length === 0
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
