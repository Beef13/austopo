import { chromium } from 'playwright'

// Verifies numbered waypoint badges: placing N points shows badges 1..N with a
// green start and red end, deleting a point renumbers, and the invisible hit
// target still lets you drag (badge follows) and delete.
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
await page.uncheck('.route-snap input')

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(300)
}

// Place a 3-point route.
await tap(240, 300)
await tap(440, 300)
await tap(640, 300)
await page.waitForTimeout(300)

const readBadges = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.route-wp-badge')).map((b) => ({
      label: b.textContent?.trim(),
      start: b.classList.contains('route-wp-start'),
      end: b.classList.contains('route-wp-end'),
    })),
  )
const afterPlace = await readBadges()

// Delete the middle point (tap it) → should renumber to 1..2.
await tap(440, 300)
await page.waitForTimeout(300)
const afterDelete = await readBadges()

// Drag the last point and confirm its badge moved with it.
const beforeDrag = await page.evaluate(() => {
  const b = document.querySelectorAll('.route-wp-badge')
  const last = b[b.length - 1]
  return last.getBoundingClientRect().x
})
await page.mouse.move(box.x + 440, box.y + 300)
await page.mouse.down()
await page.mouse.move(box.x + 500, box.y + 420, { steps: 8 })
await page.mouse.move(box.x + 540, box.y + 460, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
const afterDrag = await page.evaluate(() => {
  const b = document.querySelectorAll('.route-wp-badge')
  const last = b[b.length - 1]
  return last.getBoundingClientRect().x
})

await browser.close()

const labels = (arr) => arr.map((b) => b.label).join(',')
const placeOk =
  afterPlace.length === 3 &&
  labels(afterPlace) === '1,2,3' &&
  afterPlace[0].start &&
  afterPlace[2].end
const deleteOk = afterDelete.length === 2 && labels(afterDelete) === '1,2'
const dragOk = Math.abs(afterDrag - beforeDrag) > 40

console.log(
  JSON.stringify(
    {
      placeOk,
      deleteOk,
      dragOk,
      afterPlace,
      afterDelete,
      beforeDrag,
      afterDrag,
      errors,
    },
    null,
    2,
  ),
)
