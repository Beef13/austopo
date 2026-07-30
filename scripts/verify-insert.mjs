import { chromium } from 'playwright'

// Verifies the line-insertion tolerance: a tap slightly off the line should
// INSERT a point on that segment (distance barely changes), not APPEND to the
// end (which would roughly +50% for a mid-line click). Snap is turned off so the
// straight-line geometry is deterministic.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=14'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(4000)

await page.click('.route-btn')
await page.waitForSelector('.route-panel', { timeout: 5000 })
await page.uncheck('.route-snap input')

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const distanceKm = () =>
  page.evaluate(() => {
    const stat = Array.from(document.querySelectorAll('.route-stat')).find(
      (s) => s.querySelector('.route-stat-key')?.textContent?.trim() === 'distance',
    )
    const t = stat?.querySelector('.route-stat-val')?.textContent?.trim() ?? ''
    const n = parseFloat(t)
    return t.includes('km') ? n : n / 1000
  })
const tapAt = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(400)
}

// A straight horizontal line A---B.
await tapAt(240, 300)
await tapAt(640, 300)
const before = await distanceKm()

// Tap 11px below the midpoint — off the ~4px line but within tolerance.
await tapAt(440, 311)
const after = await distanceKm()

await page.screenshot({ path: '/tmp/austopo-insert.png' })
await browser.close()

const ratio = after / before
const inserted = ratio < 1.3 // append would be ~1.5x+
console.log(JSON.stringify({ inserted, before, after, ratio, errors }, null, 2))
