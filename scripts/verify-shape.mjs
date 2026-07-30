import { chromium } from 'playwright'

// Verifies the route shape actions with snapping off (deterministic straight
// lines): Reverse keeps distance, Out & back ~doubles it, Close loop adds the
// closing edge.
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
const km = () =>
  page.evaluate(() => {
    const stat = Array.from(document.querySelectorAll('.route-stat')).find(
      (s) => s.querySelector('.route-stat-key')?.textContent?.trim() === 'distance',
    )
    const t = stat?.querySelector('.route-stat-val')?.textContent?.trim() ?? ''
    const n = parseFloat(t)
    return t.includes('km') ? n : n / 1000
  })
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(300)
}
const place = async (pts) => {
  for (const [x, y] of pts) await tap(x, y)
}
const clear = async () => {
  await page.click('.route-panel button:has-text("Clear")')
  await page.waitForTimeout(200)
}

// Reverse: distance unchanged.
await place([
  [240, 300],
  [440, 300],
  [640, 300],
])
const d1 = await km()
await page.click('button:has-text("Reverse")')
await page.waitForTimeout(400)
const d2 = await km()

// Out & back: toggles on/off; repeated clicks must not keep growing.
await clear()
await place([
  [240, 300],
  [440, 300],
  [640, 300],
])
const d3 = await km()
const clickOB = async () => {
  await page.click('button:has-text("Out & back")')
  await page.waitForTimeout(400)
  return km()
}
const ob1 = await clickOB()
const ob2 = await clickOB()
const ob3 = await clickOB()

// Close loop: toggles the closing edge on/off.
await clear()
await place([
  [240, 300],
  [560, 260],
  [440, 480],
])
const d5 = await km()
const clickLoop = async () => {
  await page.click('button:has-text("Close loop")')
  await page.waitForTimeout(400)
  return km()
}
const loop1 = await clickLoop()
const loop2 = await clickLoop()

await browser.close()

const near = (a, b, tol = 0.02) => Math.abs(a - b) / b < tol
const reverseOk = near(d2, d1)
// on ~2x, off back to base, on again ~2x (not 3x/4x).
const outBackOk =
  ob1 / d3 > 1.8 && ob1 / d3 < 2.2 && near(ob2, d3) && ob3 / d3 > 1.8 && ob3 / d3 < 2.2
const loopOk = loop1 > d5 * 1.05 && near(loop2, d5)
console.log(
  JSON.stringify(
    {
      reverseOk,
      outBackOk,
      loopOk,
      reverse: { d1, d2 },
      outBack: { d3, ob1, ob2, ob3 },
      loop: { d5, loop1, loop2 },
      errors,
    },
    null,
    2,
  ),
)
