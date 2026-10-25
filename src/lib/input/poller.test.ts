import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startGamepadPoller } from './poller'
import { dispatchCommand } from './commands'
import { startSteamChordTracker } from './steamChord'
vi.mock('./commands', () => ({ dispatchCommand: vi.fn() }))

function pad(index: number, id = `controller-${index}`): Gamepad {
  return { index, id, connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) } as unknown as Gamepad
}
function press(p: Gamepad, button: number, pressed: boolean) {
  Object.assign(p.buttons[button], { pressed, value: Number(pressed) })
}
let frame: FrameRequestCallback
let pads: (Gamepad | null)[]
let stop: () => void
let time: number
let focused: boolean
let stopChord: () => void
function tick(n = 1) { for (let i = 0; i < n; i++) { time += 16; frame(time) } }
beforeEach(() => {
  time = 0
  focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  stopChord = startSteamChordTracker()
  pads = [pad(0), pad(1)]
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads })
  vi.mocked(dispatchCommand).mockClear()
  stop = startGamepadPoller()
})
afterEach(() => { stop(); stopChord(); history.replaceState({}, '', '/'); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('per-controller input state', () => {
  for (const index of [0, 1]) {
    it(`fires one command per press from slot ${index} with an idle peer`, () => {
      const p = pads[index]!
      press(p, 0, true); tick(60)
      expect(dispatchCommand).toHaveBeenCalledTimes(1)
      press(p, 0, false); tick()
      press(p, 0, true); tick(60)
      expect(dispatchCommand).toHaveBeenCalledTimes(2)
    })
  }
  it('preserves independent edges when both controllers press the same button', () => {
    press(pads[0]!, 0, true); tick()
    press(pads[1]!, 0, true); tick(10)
    expect(dispatchCommand).toHaveBeenCalledTimes(2)
  })
  it('does not restart stick presses or lose repeat to an idle peer', () => {
    (pads[0]!.axes as number[])[0] = 0.8
    tick(10)
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    tick(20)
    expect(vi.mocked(dispatchCommand).mock.calls.length).toBeGreaterThan(1)
    ;(pads[0]!.axes as number[])[0] = 0
    tick()
    const count = vi.mocked(dispatchCommand).mock.calls.length
    tick(60)
    expect(dispatchCommand).toHaveBeenCalledTimes(count)
  })
  it('clears state when a controller disconnects and its slot is reused', () => {
    press(pads[0]!, 0, true); tick()
    pads[0] = null; tick()
    pads[0] = pad(0); press(pads[0], 0, true); tick(10)
    expect(dispatchCommand).toHaveBeenCalledTimes(2)
  })
  it('clears state when a different device replaces a slot between frames', () => {
    press(pads[0]!, 0, true); tick()
    pads[0] = pad(0, 'replacement'); press(pads[0], 0, true); tick()
    expect(dispatchCommand).toHaveBeenCalledTimes(2)
  })
  it('retains single-controller behavior with sparse gamepad slots', () => {
    pads = [null, pad(1)]
    press(pads[1]!, 0, true); tick(60)
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
  })
  it('keeps skip hold repeat independent of an idle controller and stops on release', () => {
    history.replaceState({}, '', '/watch/test')
    press(pads[0]!, 7, true); tick(10)
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).toHaveBeenCalledWith('next')
    tick(30)
    expect(vi.mocked(dispatchCommand).mock.calls.length).toBeGreaterThan(1)
    press(pads[0]!, 7, false); tick()
    const count = vi.mocked(dispatchCommand).mock.calls.length
    tick(60)
    expect(dispatchCommand).toHaveBeenCalledTimes(count)
  })
  it('does not repeat navigation buttons when held outside playback', () => {
    press(pads[1]!, 7, true); tick(120)
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
  })
  it('stops the animation loop on cleanup', () => {
    stop()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })
})


describe('Steam overlay input suspension', () => {
  it('does not dispatch or capture presses while focus is elsewhere', () => {
    focused = false
    window.dispatchEvent(new Event('blur'))
    press(pads[0]!, 0, true)
    press(pads[1]!, 9, true)
    ;(pads[0]!.axes as number[])[0] = 0.8
    tick(60)
    expect(dispatchCommand).not.toHaveBeenCalled()
  })
  it('waits for neutral after focus returns, then accepts fresh presses', () => {
    focused = false; window.dispatchEvent(new Event('blur'))
    press(pads[0]!, 0, true); tick()
    focused = true; window.dispatchEvent(new Event('focus')); tick(60)
    expect(dispatchCommand).not.toHaveBeenCalled()
    press(pads[0]!, 0, false); tick()
    press(pads[0]!, 0, true); tick()
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).toHaveBeenCalledWith('confirm')
  })
  it('latches focus loss even if blur and focus happen between frames', () => {
    window.dispatchEvent(new Event('blur'))
    press(pads[0]!, 1, true)
    window.dispatchEvent(new Event('focus'))
    tick(10)
    expect(dispatchCommand).not.toHaveBeenCalled()
  })
  it('cancels an existing stick repeat and does not resume it on return', () => {
    (pads[0]!.axes as number[])[0] = 0.8; tick(30)
    const count = vi.mocked(dispatchCommand).mock.calls.length
    focused = false; window.dispatchEvent(new Event('blur')); tick(60)
    focused = true; tick(60)
    expect(dispatchCommand).toHaveBeenCalledTimes(count)
    ;(pads[0]!.axes as number[])[0] = 0; tick()
    ;(pads[0]!.axes as number[])[0] = 0.8; tick()
    expect(dispatchCommand).toHaveBeenCalledTimes(count + 1)
  })
  it('suspends while a Steam chord is held even before focus changes', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }))
    press(pads[0]!, 0, true); tick(10)
    expect(dispatchCommand).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' })); tick(10)
    expect(dispatchCommand).not.toHaveBeenCalled()
    press(pads[0]!, 0, false); tick()
    press(pads[0]!, 0, true); tick()
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).toHaveBeenCalledWith('confirm')
  })
  it('does not let an idle peer rearm a controller with a held button', () => {
    focused = false; tick()
    press(pads[1]!, 9, true)
    focused = true; tick(60)
    expect(dispatchCommand).not.toHaveBeenCalled()
    press(pads[0]!, 0, true); tick()
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).toHaveBeenCalledWith('confirm')
  })
  it('handles hidden pages and waits for release when shown again', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    press(pads[0]!, 0, true); tick(10)
    expect(dispatchCommand).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible'); tick(10)
    expect(dispatchCommand).not.toHaveBeenCalled()
    press(pads[0]!, 0, false); tick()
    press(pads[0]!, 0, true); tick()
    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).toHaveBeenCalledWith('confirm')
  })
  it('cancels skip repeats while an overlay owns input', () => {
    history.replaceState({}, '', '/watch/test')
    press(pads[0]!, 7, true); tick(30)
    const count = vi.mocked(dispatchCommand).mock.calls.length
    focused = false; window.dispatchEvent(new Event('blur')); tick(60)
    focused = true; tick(60)
    expect(dispatchCommand).toHaveBeenCalledTimes(count)
  })
})
