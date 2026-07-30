import { chromium } from 'playwright'

// Verifies snap-to-paths routing + estimated time end to end: opens the route
// tool, drops two waypoints on the map, and checks that BRouter was called
// (snapping) and the distance / est. time stats populate.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=14'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })

const brouter = []
page.on('response', (res) => {
  const u = res.url()
  if (u.includes('brouter.de/brouter')) {
    const profile = new URL(u).searchParams.get('profile')
    brouter.push({ status: res.status(), profile })
  }
})
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(5000)

// Open the route planner.
await page.click('.route-btn')
await page.waitForSelector('.route-panel', { timeout: 5000 })

// Work on the left side so we don't hit the right-aligned route panel.
const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const panelBox = await page.locator('.route-panel').boundingBox()

const readDistance = () =>
  page.evaluate(() => {
    const stat = Array.from(document.querySelectorAll('.route-stat')).find(
      (s) => s.querySelector('.route-stat-key')?.textContent?.trim() === 'distance',
    )
    return stat?.querySelector('.route-stat-val')?.textContent?.trim()
  })

// Phase 1: panning the map should NOT drop markers.
const pan = async (x1, y1, x2, y2) => {
  await page.mouse.move(box.x + x1, box.y + y1)
  await page.mouse.down()
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2, { steps: 6 })
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}
await pan(300, 300, 200, 420)
await pan(250, 420, 360, 300)
await page.waitForTimeout(1500)
const afterPan = { distance: await readDistance(), brouterCalls: brouter.length }

// Phase 2: genuine taps should drop markers and snap a route.
const tapAt = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(500)
}
await tapAt(240, 300)
await tapAt(380, 440)
await page.waitForTimeout(4000)

const stats = await page.evaluate(() => {
  const vals = Array.from(document.querySelectorAll('.route-stat')).map((s) => ({
    key: s.querySelector('.route-stat-key')?.textContent?.trim(),
    val: s.querySelector('.route-stat-val')?.textContent?.trim(),
  }))
  return {
    stats: vals,
    snapChecked: document.querySelector('.route-snap input')?.checked,
    activity: document.querySelector('.route-activity select')?.value,
  }
})

await page.screenshot({ path: '/tmp/austopo-routing.png' })
await browser.close()

const panOk = afterPan.distance === '0 m' && afterPan.brouterCalls === 0
console.log(
  JSON.stringify(
    { panOk, afterPan, brouter, stats, panelBox, errors },
    null,
    2,
  ),
)
