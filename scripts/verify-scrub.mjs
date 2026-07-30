import { chromium } from 'playwright'

// Verifies the interactive elevation profile: scrubbing the chart shows a
// distance/elevation/grade readout and moves a marker along the route on the
// map (different scrub positions => different marker position).
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=14'

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
  await page.waitForTimeout(400)
}
await tap(240, 300)
await tap(360, 480)

// Wait for the elevation profile to render.
await page.waitForSelector('.elev-line', { timeout: 15000 })
await page.waitForTimeout(500)

const chart = await page.locator('.elev-chart').boundingBox()
const scrub = async (frac) => {
  await page.mouse.move(chart.x + chart.width * frac, chart.y + chart.height / 2)
  await page.waitForTimeout(250)
  return page.evaluate(() => {
    const readout = document.querySelector('.elev-readout')?.textContent?.trim() || null
    const marker = document.querySelector('.elev-cursor-marker')
    return { readout, hasMarker: !!marker, transform: marker?.style.transform || null }
  })
}

const a = await scrub(0.25)
const b = await scrub(0.75)

// Leave the chart -> marker should disappear.
await page.mouse.move(chart.x + chart.width / 2, chart.y - 40)
await page.waitForTimeout(300)
const afterLeave = await page.evaluate(() => !!document.querySelector('.elev-cursor-marker'))

await page.screenshot({ path: '/tmp/austopo-scrub.png' })
await browser.close()

const ok =
  a.readout &&
  b.readout &&
  a.hasMarker &&
  b.hasMarker &&
  a.transform !== b.transform &&
  afterLeave === false
console.log(JSON.stringify({ ok, a, b, afterLeave, errors }, null, 2))
