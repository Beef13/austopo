import { chromium } from 'playwright'

// Verifies that only one tool panel is open at a time, that opening one minimises
// the others (hidden via the animation classes), and that a minimised tool keeps
// its state (route distance survives a round-trip through the measure panel).
const APP_URL =
  process.env.URL || 'http://localhost:5211/?lat=-33.7150&lng=150.3120&z=13'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
// Wait until the stylesheet is applied and panels are actually collapsed (avoids
// a Vite dev cold-start race where CSS is injected a beat after first paint).
await page.waitForFunction(() => {
  const el = document.querySelector('.measure-panel')
  return el && getComputedStyle(el).visibility === 'hidden'
})
await page.waitForTimeout(3000)

// Read the open/closed + actually-hidden state of a panel by class + computed CSS.
const panelState = async (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return { present: false }
    const cs = getComputedStyle(el)
    return {
      present: true,
      open: el.classList.contains('is-open'),
      hidden: cs.visibility === 'hidden' || Number(cs.opacity) < 0.5,
    }
  }, sel)

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(350)
}
const textOf = async (sel) =>
  page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel)

// The collapsed panels overlap the button stack; they're hidden (pointer-events
// none, visibility hidden) so real clicks pass through, but Playwright's
// actionability check is over-cautious about the overlap — force the toggles.
const clickBtn = (sel) => page.click(sel, { force: true })

// 1) Open Route, build a little route on the left (clear of the panel).
await clickBtn('.route-btn')
await page.waitForTimeout(300)
await tap(200, 300)
await tap(320, 460)
await tap(180, 560)
// Path-snapping is async (BRouter); wait until the distance stat is populated so
// we're comparing a real value across the minimise round-trip.
await page.waitForFunction(
  () => {
    const el = document.querySelector('.route-stat-val')
    return el && el.textContent && el.textContent !== '0 m'
  },
  { timeout: 15000 },
)
const routeDist1 = await textOf('.route-stat-val')
const afterRouteOpen = {
  route: await panelState('.route-panel'),
  measure: await panelState('.measure-panel'),
}

// 2) Open Measure — Route should minimise (hidden), Measure should show.
await clickBtn('.measure-btn')
await page.waitForTimeout(400)
const afterMeasureOpen = {
  route: await panelState('.route-panel'),
  measure: await panelState('.measure-panel'),
}
// Route distance text is still in the DOM even while its panel is hidden.
const routeDistWhileHidden = await textOf('.route-stat-val')

// 3) Re-open Route — Measure minimises, route state intact.
await clickBtn('.route-btn')
await page.waitForTimeout(400)
const afterReopen = {
  route: await panelState('.route-panel'),
  measure: await panelState('.measure-panel'),
}
const routeDist2 = await textOf('.route-stat-val')

await browser.close()

const out = {
  routeDist1,
  routeDistWhileHidden,
  routeDist2,
  afterRouteOpen,
  afterMeasureOpen,
  afterReopen,
  errors,
}
console.log(JSON.stringify(out, null, 2))

const ok =
  afterRouteOpen.route.open &&
  !afterRouteOpen.measure.open &&
  afterRouteOpen.measure.hidden &&
  afterMeasureOpen.measure.open &&
  !afterMeasureOpen.route.open &&
  afterMeasureOpen.route.hidden &&
  afterReopen.route.open &&
  !afterReopen.measure.open &&
  routeDist1 !== '0 m' &&
  routeDist1 === routeDist2 &&
  routeDist2 === routeDistWhileHidden &&
  errors.length === 0

console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
