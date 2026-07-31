import { chromium } from 'playwright'

// With snapping ON, badges must sit on the drawn (snapped) line even when the
// user taps off-road. Places points, waits for the snap, then checks each badge
// centre hit-tests the route line within a small tolerance box.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-37.9805&lng=145.1744&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
let brouter = 0
page.on('response', (r) => {
  if (r.url().includes('brouter.de/brouter')) brouter++
})

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(4000)
await page.click('.route-btn')
await page.waitForSelector('.route-panel', { timeout: 5000 })
// Leave snapping ON (default).

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(400)
}
// Deliberately tap in open/off-road spots.
await tap(300, 350)
await tap(520, 250)
await tap(640, 520)
await tap(360, 640)
// Wait for snapping to settle.
await page.waitForTimeout(6000)

// For each badge, hit-test the line under its centre (in canvas coords).
const result = await page.evaluate((canvasBox) => {
  const m = window.__map
  const badges = Array.from(document.querySelectorAll('.route-wp-badge'))
  const checks = badges.map((b) => {
    const r = b.getBoundingClientRect()
    const cx = r.x + r.width / 2 - canvasBox.x
    const cy = r.y + r.height / 2 - canvasBox.y
    const tol = 8
    const feats = m.queryRenderedFeatures(
      [
        [cx - tol, cy - tol],
        [cx + tol, cy + tol],
      ],
      { layers: ['route-line'] },
    )
    return { label: b.textContent.trim(), onLine: feats.length > 0 }
  })
  return checks
}, box)

await page.screenshot({ path: '/tmp/austopo-badges.png' })
await browser.close()

const allOnLine = result.length >= 3 && result.every((c) => c.onLine)
console.log(
  JSON.stringify({ allOnLine, brouterCalls: brouter, result, errors }, null, 2),
)
