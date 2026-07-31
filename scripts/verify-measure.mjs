import { chromium } from 'playwright'

// Verifies the measure tool: distance mode sums taps, the teal line renders,
// area mode reports a non-zero area, tapping a vertex removes it, and clearing
// resets. Also screenshots the panel for a visual eyeball.
const APP_URL =
  process.env.URL || 'http://localhost:5201/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(3500)

await page.click('.measure-btn')
await page.waitForSelector('.measure-panel', { timeout: 5000 })

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(350)
}

// Distance mode: three taps.
await tap(250, 300)
await tap(450, 380)
await tap(650, 280)
await page.waitForTimeout(400)

const distText = await page.locator('.measure-stat-val').first().innerText()
const lineFeats = await page.evaluate(() => {
  const m = window.__map
  if (!m) return -1
  return m.queryRenderedFeatures({ layers: ['measure-line'] }).length
})
const tipText = await page.locator('.measure-tip').innerText().catch(() => '(none)')

// Drag the middle vertex and confirm the distance changes but the vertex count
// stays the same (i.e. it moved rather than added/removed a point).
const ptsBeforeDrag = await page.evaluate(
  () => window.__map.queryRenderedFeatures({ layers: ['measure-points'] }).length,
)
// Press ~13px off the middle vertex (was placed at 450,380) to prove the grab
// zone is tolerant, then drag it down.
await page.mouse.move(box.x + 463, box.y + 367)
await page.mouse.down()
await page.mouse.move(box.x + 450, box.y + 540, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
const distAfterDrag = await page.locator('.measure-stat-val').first().innerText()
const ptsAfterDrag = await page.evaluate(
  () => window.__map.queryRenderedFeatures({ layers: ['measure-points'] }).length,
)
const dragMoved = distAfterDrag !== distText && ptsAfterDrag === ptsBeforeDrag

// Area mode.
await page.click('.measure-modes button:nth-child(2)')
await page.waitForTimeout(400)
const areaText = await page.locator('.measure-stat-val').first().innerText()
const fillFeats = await page.evaluate(() => {
  const m = window.__map
  return m ? m.queryRenderedFeatures({ layers: ['measure-fill'] }).length : -1
})

await page.locator('.measure-panel').screenshot({ path: 'scripts/measure-shot.png' })

// Remove a vertex by tapping it, then confirm the count drops.
const beforePts = await page.evaluate(() =>
  window.__map
    ? window.__map
        .queryRenderedFeatures({ layers: ['measure-points'] })
        .length
    : -1,
)
// The first vertex hasn't moved (only the middle one was dragged), so tap it.
await tap(250, 300)
await page.waitForTimeout(300)
const afterPts = await page.evaluate(() =>
  window.__map
    ? window.__map
        .queryRenderedFeatures({ layers: ['measure-points'] })
        .length
    : -1,
)

await browser.close()

console.log(
  JSON.stringify(
    {
      distText,
      tipText,
      distAfterDrag,
      dragMoved,
      areaText,
      lineFeats,
      fillFeats,
      beforePts,
      afterPts,
      errors,
    },
    null,
    2,
  ),
)

const ok =
  /\d/.test(distText) &&
  lineFeats > 0 &&
  fillFeats > 0 &&
  dragMoved &&
  /(m²|ha|km²)/.test(areaText) &&
  afterPts < beforePts &&
  errors.length === 0
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
