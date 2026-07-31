import { chromium } from 'playwright'

// Draws a route and screenshots the elevation panel so we can eyeball the axis
// labelling against the reference design.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } })
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
await tap(200, 300)
await tap(360, 420)
await tap(520, 260)
await page.waitForSelector('.route-elev-chart svg', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(3000)

const panel = page.locator('.route-elev')
await panel.screenshot({ path: 'scripts/profile-shot.png' })
await browser.close()
console.log('saved scripts/profile-shot.png')
