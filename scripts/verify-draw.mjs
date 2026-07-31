import { chromium } from 'playwright'

// Verifies the new segment is progressively "drawn" (animated) as points are
// placed, rather than appearing as a single frame. Uses snap OFF so the line is
// a deterministic straight segment, and reads a dev-only frame counter plus the
// rendered line to confirm the reveal ran and settled on the full geometry.
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
// FIRST exercises the very first segment (snap on), which used to flash a
// straight line then swap in the snapped curve as a frame.
const FIRST = process.env.FIRST === 'on'
const SNAP = FIRST || process.env.SNAP === 'on'
if (!SNAP) await page.uncheck('.route-snap input')

const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
const tap = async (dx, dy) => {
  await page.mouse.click(box.x + dx, box.y + dy)
  await page.waitForTimeout(300)
}

// Keep well left of the ~292px route panel on the right edge so taps land on the
// map. For FIRST we place only one point, then draw the first segment; otherwise
// we establish a two-point line and then extend it.
const endX = 600
if (FIRST) {
  await tap(160, 300)
  await page.waitForTimeout(400)
} else {
  await tap(160, 300)
  await tap(300, 300)
  await page.waitForTimeout(500)
}

// Reset the counters, then place the next point. Measure the click→reveal-start
// latency entirely in-page (no Playwright round-trip) so it's accurate: it should
// begin within a frame or two (the instant straight stub), not after the routing
// round-trip. The probe also performs the click.
const latencyMs = await page.evaluate(
  ({ x, y }) =>
    new Promise((resolve) => {
      const canvas = document.querySelector('canvas.maplibregl-canvas')
      const rect = canvas.getBoundingClientRect()
      window.__drawFrames = 0
      window.__drawProgress = undefined
      const t0 = performance.now()
      const tick = () => {
        const p = window.__drawProgress
        if (p !== undefined && p !== null) return resolve(performance.now() - t0)
        if (performance.now() - t0 > 1500) return resolve(-1)
        requestAnimationFrame(tick)
      }
      const opts = { bubbles: true, cancelable: true, clientX: rect.left + x, clientY: rect.top + y }
      canvas.dispatchEvent(new MouseEvent('mousedown', opts))
      canvas.dispatchEvent(new MouseEvent('mouseup', opts))
      canvas.dispatchEvent(new MouseEvent('click', opts))
      requestAnimationFrame(tick)
    }),
  { x: endX, y: 300 },
)

// Sample the reveal progress across the animation window (snap refines onto the
// trail as the network result arrives).
const samples = []
const iters = SNAP ? 40 : 30
for (let i = 0; i < iters; i++) {
  await page.waitForTimeout(45)
  samples.push(
    await page.evaluate(() => ({
      frames: window.__drawFrames ?? 0,
      progress: window.__drawProgress ?? null,
    })),
  )
}
await page.waitForTimeout(400)

// Final drawn line should reach the new endpoint.
const endHit = await page.evaluate(({ ex, ey }) => {
  const m = window.__map
  if (!m) return 0
  const pad = 8
  return m.queryRenderedFeatures(
    [
      [ex - pad, ey - pad],
      [ex + pad, ey + pad],
    ],
    { layers: ['route-line'] },
  ).length
}, { ex: endX, ey: 300 })

await browser.close()

const framesRan = Math.max(...samples.map((s) => s.frames))
const progresses = samples.map((s) => s.progress).filter((p) => p !== null)
const minProg = progresses.length ? Math.min(...progresses) : null
const maxProg = progresses.length ? Math.max(...progresses) : null
// A real reveal: several intermediate frames, progress that starts partway (the
// junction) and grows to a full 1, and the line geometry reaches the endpoint.
const animated = framesRan >= 3
const grew = minProg !== null && maxProg !== null && maxProg - minProg > 0.1
const settled = maxProg !== null && maxProg >= 0.999
const reachedEnd = endHit > 0
console.log(
  JSON.stringify(
    { animated, grew, settled, reachedEnd, latencyMs, framesRan, minProg, maxProg, errors },
    null,
    2,
  ),
)

if (!animated || !grew || !settled || !reachedEnd) process.exit(1)
