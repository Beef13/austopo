import { chromium } from 'playwright'

// Verifies that adding a point places its badge at the click location straight
// away (not flashing onto the old path first). With snapping on, a new point
// must NOT project onto the stale line; it should sit at the tap until its own
// snap arrives, then settle onto the fresh line near the click.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-37.9805&lng=145.1744&z=14'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(4000)
await page.click('.route-btn')
await page.waitForSelector('.route-panel', { timeout: 5000 })

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
}
const metersBetween = (a, b) => {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const la = (a[1] * Math.PI) / 180
  const lb = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Two points along a road, let them snap.
await tap(300, 320)
await page.waitForTimeout(400)
await tap(560, 320)
await page.waitForTimeout(6000)

// The click location for the new (3rd) point, well off the existing E-W line.
const clickPx = [430, 620]
const clickLngLat = await page.evaluate(([x, y]) => {
  const c = window.__map.unproject([x, y])
  return [c.lng, c.lat]
}, clickPx)

// Tap the new point and read its badge almost immediately (before snap lands).
await tap(clickPx[0], clickPx[1])
await page.waitForTimeout(150)
const lastBadgeLngLat = async () =>
  page.evaluate(() => {
    const bs = document.querySelectorAll('.route-wp-badge')
    const b = bs[bs.length - 1]
    const r = b.getBoundingClientRect()
    const cont = window.__map.getContainer().getBoundingClientRect()
    const c = window.__map.unproject([
      r.x + r.width / 2 - cont.x,
      r.y + r.height / 2 - cont.y,
    ])
    return [c.lng, c.lat]
  })
const immediate = await lastBadgeLngLat()
const immediateOffset = Math.round(metersBetween(immediate, clickLngLat))

// After the snap settles, it should be on the line and still near the click.
await page.waitForTimeout(6000)
const settled = await lastBadgeLngLat()
const settledOffset = Math.round(metersBetween(settled, clickLngLat))
const settledOnLine = await page.evaluate(() => {
  const bs = document.querySelectorAll('.route-wp-badge')
  const b = bs[bs.length - 1]
  const r = b.getBoundingClientRect()
  const cont = window.__map.getContainer().getBoundingClientRect()
  const cx = r.x + r.width / 2 - cont.x
  const cy = r.y + r.height / 2 - cont.y
  const feats = window.__map.queryRenderedFeatures(
    [
      [cx - 8, cy - 8],
      [cx + 8, cy + 8],
    ],
    { layers: ['route-line'] },
  )
  return feats.length > 0
})

await browser.close()

// Immediately after the click the badge should be ~at the click (< 30 m),
// definitely not hundreds of metres away on the old path.
console.log(
  JSON.stringify(
    {
      appearsAtClick: immediateOffset < 30,
      settledOnLine,
      immediateOffset,
      settledOffset,
      errors,
    },
    null,
    2,
  ),
)
