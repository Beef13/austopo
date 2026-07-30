import { chromium } from 'playwright'

// Verifies desktop cursor-follow: hovering the map shows the coordinate/elevation
// under the cursor (crosshair hidden), and leaving the map reverts to the centre
// readout (crosshair shown).
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(3500)

const snapshot = () =>
  page.evaluate(() => {
    const cross = document.querySelector('.center-crosshair')
    return {
      latlon: document.querySelector('.coord-latlon')?.textContent?.trim() || null,
      elev: document.querySelector('.coord-elev')?.textContent?.trim() || null,
      probing: document.body.classList.contains('cursor-probe'),
      crosshairVisible: cross ? getComputedStyle(cross).display !== 'none' : false,
    }
  })

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const move = async (dx, dy) => {
  await page.mouse.move(box.x + dx, box.y + dy)
  await page.waitForTimeout(300)
  return snapshot()
}

const center = await snapshot()
const a = await move(300, 250)
const b = await move(720, 470)
// Move up into the header (off the map canvas) to leave the map.
await page.mouse.move(300, 20)
await page.waitForTimeout(400)
const left = await snapshot()

await page.screenshot({ path: '/tmp/austopo-cursor.png' })
await browser.close()

const ok =
  a.probing &&
  !a.crosshairVisible &&
  a.latlon !== center.latlon &&
  b.latlon !== a.latlon &&
  !left.probing &&
  left.crosshairVisible
console.log(JSON.stringify({ ok, center, a, b, left, errors }, null, 2))
