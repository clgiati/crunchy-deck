import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appOwnsInput } from './activity'
import { dispatchCommand } from './commands'
import { ensureFocus } from './navigate'
import { closeNav, isNavOpen } from '$lib/nav/overlays'

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  document.body.innerHTML = '<button id="target" data-focusable>Target</button>'
  closeNav()
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; closeNav() })
it('blocks commands and focus repair while another window owns input', () => {
  vi.mocked(document.hasFocus).mockReturnValue(false)
  const click = vi.fn()
  document.getElementById('target')!.addEventListener('click', click)
  document.getElementById('target')!.focus()
  dispatchCommand('confirm')
  dispatchCommand('menu')
  expect(click).not.toHaveBeenCalled()
  expect(isNavOpen()).toBe(false)
  document.getElementById('target')!.blur()
  ensureFocus()
  expect(document.activeElement).toBe(document.body)
})
it('blocks hidden pages even when focus is reported as true', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  expect(appOwnsInput()).toBe(false)
  dispatchCommand('menu')
  expect(isNavOpen()).toBe(false)
})
it('accepts commands and focus repair when the app is active', () => {
  expect(appOwnsInput()).toBe(true)
  ensureFocus()
  expect(document.activeElement?.id).toBe('target')
  dispatchCommand('menu')
  expect(isNavOpen()).toBe(true)
})
