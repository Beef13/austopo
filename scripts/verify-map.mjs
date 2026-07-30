import { chromium } from 'playwright'

const URL = process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=13'
const OUT = process.env.OUT || '/tmp/austopo-verify.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })

const reqs = { pbf: 0, glyphs: 0, sprite: 0, styleJson: 0, png: 0, status403: 0 }
page.on('response', (res) => {
  const u = res.url()
  if (!u.includes('api.maptiler.com')) return
  if (res.status() === 403) reqs.status403++
  if (u.includes('.pbf') || u.includes('/tiles/')) reqs.pbf++
  else if (u.includes('/fonts/')) reqs.glyphs++
  else if (u.includes('sprite')) reqs.sprite++
  else if (u.includes('style.json')) reqs.styleJson++
  else if (u.includes('.png')) reqs.png++
})

const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 }).catch(() => {})
// Let tiles/glyphs load and the map settle.
await page.waitForTimeout(6000)

const info = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.layer-option')).map((b) => ({
    label: b.textContent.trim(),
    active: b.className.includes('is-active'),
  }))
  const canvas = document.querySelector('canvas.maplibregl-canvas')
  const attrib = document.querySelector('.maplibregl-ctrl-attrib-inner')
  return {
    hasCanvas: !!canvas,
    layerButtons: btns,
    attribution: attrib ? attrib.textContent.trim() : '(none)',
  }
})

await page.screenshot({ path: OUT })
await browser.close()

console.log(JSON.stringify({ reqs, errors, ...info, screenshot: OUT }, null, 2))
