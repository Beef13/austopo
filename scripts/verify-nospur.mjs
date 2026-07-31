import { chromium } from 'playwright'

// Verifies the route doesn't needlessly double back on itself. Places snapped
// waypoints around a block (a layout prone to junction overshoot spurs) and
// scans the resulting line for short "hairpins" — a vertex where the path
// reverses direction and retraces within a small distance.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-37.9805&lng=145.1744&z=14'

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
// Zig-zag taps near roads: these encourage BRouter to overshoot at junctions.
await tap(300, 300)
await tap(470, 320)
await tap(430, 480)
await tap(600, 500)
await tap(560, 660)
await page.waitForTimeout(7000)

// Scan for hairpins: a vertex b where the path turns ~180° AND the outgoing
// leg retraces back over the incoming leg within a short distance.
const analysis = await page.evaluate(() => {
  const line = window.__routeLine || []
  const R = 6371000
  const toXY = (o, p) => {
    const mLat = 111320
    const mLng = 111320 * Math.cos((o[1] * Math.PI) / 180)
    return [(p[0] - o[0]) * mLng, (p[1] - o[1]) * mLat]
  }
  const dist = (a, b) => {
    const dLat = ((b[1] - a[1]) * Math.PI) / 180
    const dLng = ((b[0] - a[0]) * Math.PI) / 180
    const la = (a[1] * Math.PI) / 180
    const lb = (b[1] * Math.PI) / 180
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  let hairpins = 0
  const samples = []
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1]
    const b = line[i]
    const c = line[i + 1]
    const inLeg = toXY(b, a)
    const outLeg = toXY(b, c)
    const li = Math.hypot(inLeg[0], inLeg[1])
    const lo = Math.hypot(outLeg[0], outLeg[1])
    if (li < 1 || lo < 1) continue
    // cos angle between the two legs from b; near +1 means they point the same
    // way (a and c on the same side) => the path doubled back.
    const cos = (inLeg[0] * outLeg[0] + inLeg[1] * outLeg[1]) / (li * lo)
    if (cos > 0.9 && dist(a, c) < 25) {
      hairpins++
      samples.push({ i, cos: +cos.toFixed(3), ac: Math.round(dist(a, c)) })
    }
  }
  return { lineLen: line.length, hairpins, samples: samples.slice(0, 8) }
})

await page.screenshot({ path: '/tmp/austopo-nospur.png' })
await browser.close()

console.log(
  JSON.stringify(
    { ok: analysis.hairpins === 0, ...analysis, errors },
    null,
    2,
  ),
)
