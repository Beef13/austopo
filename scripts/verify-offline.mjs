// End-to-end offline test for the vector Topo layer:
//  1. Load the built app (service worker active) and let the map render.
//  2. Open the offline panel and download the current region.
//  3. Go offline, reload, and confirm the vector Topo still renders from cache
//     (MapTiler tiles/glyphs/sprite all served, no failures, no page errors).
//
// Run against a production preview server (SW only runs in the built app):
//   npm run build && npm run preview -- --port 4321
//   node scripts/verify-offline.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:4321'
const URL = `${BASE}/?lat=-33.7150&lng=150.3120&z=13`
const OUT = process.env.OUT || '/tmp/austopo-offline.png'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
const page = await context.newPage()

const log = (...a) => console.log(...a)

// --- 1. Load online and ensure the service worker controls the page ---
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 20000 })
await page.waitForFunction(() => navigator.serviceWorker?.ready, null, { timeout: 20000 })
// SW controls the page after a reload following first install.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 20000 })
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
  timeout: 20000,
})
await page.waitForTimeout(3000)

// --- 2. Download the current region for offline use ---
await page.click('button[aria-label="Offline maps"]')
// Wait for the vector manifest to load (button leaves the "Preparing…" state).
await page
  .waitForFunction(
    () => {
      const b = document.querySelector('.offline-download')
      return b && !b.disabled && !/Preparing/.test(b.textContent || '')
    },
    null,
    { timeout: 30000 },
  )
  .catch(() => {})

const estimate = await page.evaluate(() => {
  const el = document.querySelector('.offline-stats')
  return el ? el.textContent : '(no stats)'
})
log('Estimate:', estimate?.replace(/\s+/g, ' ').trim())

// Count MapTiler responses by status during the download phase to confirm the
// download actually caches (200s) rather than being rejected (403s).
const dl = { ok: 0, notFound: 0, forbidden: 0, other: 0 }
const dlListener = (res) => {
  if (!res.url().includes('api.maptiler.com')) return
  const s = res.status()
  if (s === 200) dl.ok++
  else if (s === 403) dl.forbidden++
  else if (s === 404) dl.notFound++
  else dl.other++
}
page.on('response', dlListener)
const cacheBefore = await page.evaluate(
  () => document.querySelector('.offline-storage span')?.textContent,
)
log('Cache before download:', cacheBefore)

await page.click('.offline-download')
// Wait for the download to finish: progress disappears and items are stored.
await page.waitForFunction(
  () => {
    const storage = document.querySelector('.offline-storage span')
    const n = storage ? parseInt(storage.textContent.replace(/[^0-9]/g, ''), 10) : 0
    const downloading = !!document.querySelector('.offline-progress')
    return !downloading && n > 0
  },
  null,
  { timeout: 120000 },
)

const stored = await page.evaluate(
  () => document.querySelector('.offline-storage span')?.textContent,
)
page.off('response', dlListener)
log('Download responses (MapTiler):', JSON.stringify(dl))
log('Stored after download:', stored)

// --- 3. Go offline and reload ---
await context.setOffline(true)

const offline = { pbf: 0, glyphs: 0, sprite: 0, styleJson: 0, png: 0, failed: 0 }
const errors = []
page.on('requestfailed', (req) => {
  if (req.url().includes('api.maptiler.com')) offline.failed++
})
page.on('response', (res) => {
  const u = res.url()
  if (!u.includes('api.maptiler.com')) return
  if (u.includes('/fonts/')) offline.glyphs++
  else if (u.includes('sprite')) offline.sprite++
  else if (u.includes('style.json')) offline.styleJson++
  else if (u.includes('.pbf') || u.includes('/tiles/')) offline.pbf++
  else if (u.includes('.png')) offline.png++
})
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(6000)

const info = await page.evaluate(() => {
  const active = Array.from(document.querySelectorAll('.layer-option')).find((b) =>
    b.className.includes('is-active'),
  )
  const attrib = document.querySelector('.maplibregl-ctrl-attrib-inner')
  return {
    hasCanvas: !!document.querySelector('canvas.maplibregl-canvas'),
    activeLayer: active ? active.textContent.trim() : '(none)',
    attribution: attrib ? attrib.textContent.trim() : '(none)',
    online: navigator.onLine,
  }
})

await page.screenshot({ path: OUT })
await browser.close()

log(JSON.stringify({ offlineReload: offline, errors, ...info, screenshot: OUT }, null, 2))

const ok =
  info.hasCanvas &&
  offline.failed === 0 &&
  offline.pbf + offline.png > 0 &&
  errors.length === 0
log(ok ? '\nPASS: vector Topo rendered offline from cache' : '\nFAIL: see output above')
process.exit(ok ? 0 : 1)
