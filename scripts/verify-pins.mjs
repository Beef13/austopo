import { chromium } from 'playwright'

// Verifies richer waypoint pins: dropping a pin opens the editor, choosing a
// type + notes persists, the on-map marker reflects the type colour, and the
// popup shows name/type/notes.
const APP_URL =
  process.env.URL || 'http://localhost:5199/?lat=-33.7150&lng=150.3120&z=14'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
// Start from a clean slate, then reload so the app mounts with no pins.
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(4000)

// Open pins, arm drop, tap the map.
await page.click('.pin-btn')
await page.waitForSelector('.pin-panel', { timeout: 5000 })
await page.click('.pin-drop')
const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
await page.mouse.click(box.x + 320, box.y + 300)

// Editor should auto-open for the new pin.
await page.waitForSelector('.pin-editor', { timeout: 5000 })
const editorOpened = true

// Set name, pick "Summit", add notes, save.
await page.fill('.pin-editor-name', 'Mount Test')
await page.click('.pin-type-chip[title="Summit"]')
await page.fill('.pin-editor-notes', 'Great sunrise spot')
await page.click('.pin-editor-save')
await page.waitForTimeout(400)

// The saved marker should use the summit colour (#6d4c41).
const markerColor = await page.evaluate(() => {
  const path = document.querySelector('.map-pin svg path')
  return path?.getAttribute('fill')
})

// The list row should show the type label + notes.
const rowMeta = await page.evaluate(
  () => document.querySelector('.pin-meta')?.textContent?.trim() ?? '',
)

// Persistence: reload and confirm the pin + type survive.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 15000 })
await page.waitForTimeout(4000)
const persistedColor = await page.evaluate(() => {
  const path = document.querySelector('.map-pin svg path')
  return path?.getAttribute('fill')
})

// Popup content on marker click.
await page.click('.map-pin')
await page.waitForTimeout(300)
const popup = await page.evaluate(() => {
  const p = document.querySelector('.pin-popup')
  if (!p) return null
  return {
    title: p.querySelector('.pin-popup-title')?.textContent?.trim(),
    type: p.querySelector('.pin-popup-type')?.textContent?.trim(),
    notes: p.querySelector('.pin-popup-notes')?.textContent?.trim(),
  }
})

await browser.close()

const SUMMIT = '#6d4c41'
console.log(
  JSON.stringify(
    {
      editorOpened,
      typeColorOk: markerColor === SUMMIT,
      metaOk: /Summit/.test(rowMeta) && /Great sunrise spot/.test(rowMeta),
      persistedOk: persistedColor === SUMMIT,
      popupOk:
        !!popup &&
        popup.title === 'Mount Test' &&
        popup.type === 'Summit' &&
        popup.notes === 'Great sunrise spot',
      markerColor,
      rowMeta,
      popup,
      errors,
    },
    null,
    2,
  ),
)
