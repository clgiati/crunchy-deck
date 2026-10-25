import { test, expect, type Page } from '@playwright/test'

async function frames(page: Page, n = 10) {
  await page.evaluate(async n => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame)
  }, n)
}
async function focus(page: Page, active: boolean) {
  await page.evaluate(active => {
    ;(window as any).__ownsInput = active
    window.dispatchEvent(new Event(active ? 'focus' : 'blur'))
  }, active)
}
async function button(page: Page, slot: number, index: number, pressed: boolean) {
  await page.evaluate(({ slot, index, pressed }) => {
    ;(window as any).__pads[slot].buttons[index] = { pressed, value: Number(pressed) }
  }, { slot, index, pressed })
}

for (const slot of [0, 1]) {
  test.describe(`Steam overlays with controller slot ${slot}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as any
        w.__ownsInput = true
        Object.defineProperty(document, 'hasFocus', { value: () => w.__ownsInput })
        w.__logs = []
        w.cr = {
          steam: true,
          log: (s: string) => w.__logs.push(s),
          auth: { status: async () => ({ ok: true, data: { authenticated: true } }) },
          api: { search: async () => ({ ok: true, data: [] }) }
        }
        Object.defineProperty(navigator, 'getGamepads', { value: () => w.__pads })
        w.__pads = ['DualSense', 'Steam Deck'].map((id, index) => ({
          id, index, connected: true, axes: [0, 0],
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
        }))
      })
    })

    test('Steam keyboard can type search without controller navigation or dismissal leaking through', async ({ page }) => {
      await page.goto('/search')
      const field = page.locator('#search-input')
      await expect(field).toBeFocused()
      await focus(page, false)
      // Steam's keyboard still inserts native text; raw controller A/B/d-pad/menu
      // reports must not click, navigate back, change focus or open the app menu.
      for (const index of [0, 1, 9, 13, 15]) await button(page, slot, index, true)
      await page.keyboard.insertText('naruto')
      await page.keyboard.press('ArrowDown')
      await frames(page, 40)
      await expect(field).toHaveValue('naruto')
      await expect(field).toBeFocused()
      await expect(page).toHaveURL(/\/search$/)
      await expect(page.getByRole('navigation')).toHaveCount(0)
      expect(await page.evaluate(() => (window as any).__logs.filter((s: string) => s.startsWith('[cmd]')).length)).toBe(0)
      await focus(page, true)
      await frames(page, 30)
      await expect(field).toBeFocused()
      await expect(page.getByRole('navigation')).toHaveCount(0)
      for (const index of [0, 1, 9, 13, 15]) await button(page, slot, index, false)
      await frames(page, 2)
      await button(page, slot, 9, true)
      await frames(page)
      await expect(page.getByRole('navigation')).toBeVisible()
    })

    test('Steam menu pauses a stick hold and requires neutral on return', async ({ page }) => {
      await page.goto('/demo')
      await expect(page.locator('#cw-0')).toBeFocused()
      await page.evaluate(slot => { (window as any).__pads[slot].axes[0] = 0.8 }, slot)
      await frames(page, 4)
      await expect(page.locator('#cw-1')).toBeFocused()
      await focus(page, false)
      await frames(page, 40)
      await expect(page.locator('#cw-1')).toBeFocused()
      await focus(page, true)
      await frames(page, 40)
      await expect(page.locator('#cw-1')).toBeFocused()
      await page.evaluate(slot => { (window as any).__pads[slot].axes[0] = 0 }, slot)
      await frames(page, 2)
      await button(page, slot, 15, true)
      await frames(page, 10)
      await expect(page.locator('#cw-2')).toBeFocused()
    })

    test('Steam chord suppresses input before the overlay takes focus', async ({ page }) => {
      await page.goto('/demo')
      await expect(page.locator('#cw-0')).toBeFocused()
      await page.keyboard.down('Meta')
      await button(page, slot, 15, true)
      await frames(page, 20)
      await expect(page.locator('#cw-0')).toBeFocused()
      await page.keyboard.up('Meta')
      await frames(page, 20)
      await expect(page.locator('#cw-0')).toBeFocused()
      await button(page, slot, 15, false)
      await frames(page, 2)
      await button(page, slot, 15, true)
      await frames(page, 10)
      await expect(page.locator('#cw-1')).toBeFocused()
    })
  })
}
