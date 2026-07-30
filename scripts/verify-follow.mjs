import { chromium } from 'playwright'

// Verifies route-following with a mocked GPS position. Places a straight route
// (snap off), then moves a fake device along and off it, checking the follow
// banner reports remaining distance, arrival, and off-route state.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=14'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1000, height: 1100 },
  permissions: ['geolocation'],
  geolocation: { latitude: -33.715, longitude: 150.312, accuracy: 5 },
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(4000)
await page.click('.route-btn')
await page.waitForSelector('.route-panel', { timeout: 5000 })
await page.uncheck('.route-snap input')

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(300)
}
// A horizontal 3-point route on the left half of the screen.
const pts = [
  [240, 300],
  [440, 300],
  [640, 300],
]
for (const [x, y] of pts) await tap(x, y)
await page.waitForTimeout(500)

// Convert route pixels to geographic coordinates via the dev map handle.
const coordOf = (dx, dy) =>
  page.evaluate(
    ([x, y]) => {
      const m = window.__map
      const c = m.unproject([x, y])
      return [c.lng, c.lat]
    },
    [dx, dy],
  )
const start = await coordOf(240, 300)
const end = await coordOf(640, 300)
const offPoint = await coordOf(440, 160) // ~140px above the line

const bannerText = () =>
  page.evaluate(() => {
    const b = document.querySelector('.follow-banner')
    if (!b) return null
    return {
      line: b.querySelector('.follow-banner-line')?.textContent?.trim(),
      sub: b.querySelector('.follow-banner-sub')?.textContent?.trim(),
      off: b.classList.contains('is-off'),
      arrived: b.classList.contains('is-arrived'),
    }
  })

const setPos = async ([lng, lat]) => {
  await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 })
  await page.waitForTimeout(700)
}

// Start following, then place GPS at the route start.
await page.click('.route-follow')
await page.waitForSelector('.follow-banner', { timeout: 5000 })
await setPos(start)
const atStart = await bannerText()

// Move to the end → arrived.
await setPos(end)
const atEnd = await bannerText()

// Move off the line → off-route warning.
await setPos(offPoint)
const atOff = await bannerText()

// Progress marker should exist on the map while following.
const hasProgressMarker = await page.evaluate(
  () => !!document.querySelector('.route-progress-marker'),
)

// Stop following clears the banner.
await page.click('.follow-banner-stop')
await page.waitForTimeout(300)
const bannerAfterStop = await page.evaluate(
  () => !!document.querySelector('.follow-banner'),
)

await browser.close()

const startOk = !!atStart && !atStart.off && !atStart.arrived && /to go/.test(atStart.line)
const endOk = !!atEnd && atEnd.arrived
const offOk = !!atOff && atOff.off && /Off route/.test(atOff.line)
console.log(
  JSON.stringify(
    {
      startOk,
      endOk,
      offOk,
      hasProgressMarker,
      bannerClearedAfterStop: bannerAfterStop === false,
      atStart,
      atEnd,
      atOff,
      errors,
    },
    null,
    2,
  ),
)
