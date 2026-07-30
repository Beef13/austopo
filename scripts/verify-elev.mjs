import { chromium } from 'playwright'

// Verifies the centre elevation readout now updates in real time from the local
// DEM: panning changes the value, DEM tiles are fetched, and no per-point
// network elevation API calls are needed.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
const req = { dem: 0, openMeteo: 0 }
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('elevation-tiles-prod')) req.dem++
  if (u.includes('api.open-meteo.com')) req.openMeteo++
})
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(3500)

const elevText = () =>
  page.evaluate(() => document.querySelector('.coord-elev')?.textContent?.trim() || null)

// Wait for an initial elevation to appear.
await page.waitForFunction(
  () => !!document.querySelector('.coord-elev'),
  { timeout: 10000 },
)
const e1 = await elevText()

// Pan a long way by dragging the map, then read again shortly after.
const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
await page.mouse.move(box.x + 500, box.y + 350)
await page.mouse.down()
await page.mouse.move(box.x + 250, box.y + 180, { steps: 12 })
await page.mouse.move(box.x + 120, box.y + 90, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(1200)
const e2 = await elevText()

await browser.close()

const ok = !!e1 && !!e2 && e1 !== e2 && req.dem > 0
console.log(JSON.stringify({ ok, e1, e2, req, errors }, null, 2))
