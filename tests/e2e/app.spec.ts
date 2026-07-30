import { expect, test } from '@playwright/test'

test('loads the map and primary controls', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/?lat=-33.7150&lng=150.3120&z=13')

  await expect(page.getByText('AusTopo', { exact: true })).toBeVisible()
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByRole('textbox', { name: 'Search places in Australia' }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.floating-controls')).toBeVisible()
  await expect(page.locator('.coord-readout')).toBeVisible()

  expect(pageErrors).toEqual([])
})
