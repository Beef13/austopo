import { chromium } from 'playwright'

// Verifies the route elevation profile renders reliably from the local DEM
// tiles: after drawing a route the profile chart appears with real ascent /
// descent stats, DEM tiles are fetched, and Open-Meteo is NOT contacted (it's a
// last-resort fallback only). This is the reliability guarantee for shipping.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } })
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
await page.waitForTimeout(4000)
await page.click('.route-btn')
await page.waitForSelector('.route-panel', { timeout: 5000 })

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(500)
}

// Draw a 3-point route across varied terrain.
await tap(200, 300)
await tap(360, 420)
await tap(520, 260)

// Wait for snapping + the (debounced) elevation profile to resolve.
await page.waitForTimeout(2500)

const profile = await page.evaluate(() => {
  const svg = document.querySelector('.elev-chart')
  const stats = Array.from(document.querySelectorAll('.route-stat')).map((s) => ({
    key: s.querySelector('.route-stat-key')?.textContent?.trim(),
    val: s.querySelector('.route-stat-val')?.textContent?.trim(),
  }))
  const line = svg?.querySelector('.elev-line')
  return {
    hasChart: !!svg,
    hasLine: !!line && (line.getAttribute('d')?.length ?? 0) > 20,
    stats,
  }
})

// Continuity: adding another point must not make the chart vanish and pop back.
// Poll for the chart element throughout the update window and require it present
// in every sample.
let chartAlways = true
await page.mouse.click(box.x + 650, box.y + 380)
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(30)
  const present = await page.evaluate(() => !!document.querySelector('.elev-chart'))
  if (!present) chartAlways = false
}

await browser.close()

const stat = (k) => profile.stats.find((s) => s.key === k)?.val ?? '–'
const ascent = stat('ascent')
const descent = stat('descent')
// A real profile: chart drawn, DEM tiles used, no Open-Meteo, and ascent/descent
// are populated (not the "–" placeholder).
const ok =
  profile.hasChart &&
  profile.hasLine &&
  chartAlways &&
  req.dem > 0 &&
  req.openMeteo === 0 &&
  ascent !== '–' &&
  descent !== '–' &&
  errors.length === 0

console.log(
  JSON.stringify({ ok, chartAlways, ascent, descent, req, profile, errors }, null, 2),
)
if (!ok) process.exit(1)
