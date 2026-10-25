import { AxisTracker, type NavCommand, type Direction } from './gamepad'
import { resolveButton, feedCapture } from './bindings'
import { RepeatTimer } from './repeat'
import { setInputType } from './inputType'
import { dispatchCommand } from './commands'
import { appOwnsInput } from './activity'

function createPadState(id: string) {
  return {
    id,
    waitForNeutral: false,
    axis: new AxisTracker(0.5, 0.3),
    repeat: new RepeatTimer({ initialDelay: 320, startInterval: 120, minInterval: 45, ramp: 1000 }),
    skipRepeat: new RepeatTimer({ initialDelay: 350, startInterval: 280, minInterval: 110, ramp: 1800 }),
    prevButtons: new Map<number, boolean>(),
    heldDir: null as Direction | null,
    heldSkipBtn: null as number | null,
    heldSkipCmd: null as NavCommand | null
  }
}

export function startGamepadPoller() {
  // Edge detection and hold timers belong to a controller, never to the whole frame.
  const states = new Map<number, ReturnType<typeof createPadState>>()
  let raf = 0
  let suspended = !appOwnsInput()
  // Blur/visibility can happen between animation frames (rAF may stop entirely
  // under an overlay). Latch suspension immediately so no held input is replayed.
  const suspend = () => {
    suspended = true
    for (const [index, state] of states) {
      const fresh = createPadState(state.id)
      fresh.waitForNeutral = true
      states.set(index, fresh)
    }
  }
  const onVisibility = () => { if (document.hidden) suspend() }
  const onChord = (e: KeyboardEvent) => {
    if (e.key === 'Meta' || e.key === 'OS' || e.key === 'Alt') suspend()
  }
  window.addEventListener('blur', suspend)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onChord, true)

  // TEMP input diagnostics — reveals what the Steam Deck emits per physical button so the
  // back/menu mappings can be fixed against real evidence. Remove once mapping is confirmed.
  const onKeyLog = (e: KeyboardEvent) => window.cr?.log(`[key] ${e.key}`)
  window.addEventListener('keydown', onKeyLog)

  const now = () => performance.now()

  const dispatch = (cmd: NavCommand) => dispatchCommand(cmd)

  const loop = () => {
    if (!appOwnsInput()) {
      if (!suspended) suspend()
      raf = requestAnimationFrame(loop)
      return
    }
    const resuming = suspended
    suspended = false
    const pads = navigator.getGamepads?.() ?? []
    const connected = new Set<number>()
    for (const pad of pads) {
      if (!pad || !pad.connected) continue
      connected.add(pad.index)
      let state = states.get(pad.index)
      if (!state || state.id !== pad.id) {
        state = createPadState(pad.id)
        state.waitForNeutral = resuming
        states.set(pad.index, state)
      }
      if (state.waitForNeutral) {
        // Check the left stick only: idle trigger axes on non-standard pads may
        // report -1. Buttons (including analog triggers) must all be released.
        const neutral = !pad.buttons.some(b => b.pressed) &&
          Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) < 0.3
        if (neutral) state.waitForNeutral = false
        continue
      }
      const { axis, repeat, skipRepeat, prevButtons } = state
      setInputType('dpad')

      // buttons: fire on rising edge; HOLD a skip button to fast-forward/rewind in the player
      pad.buttons.forEach((b, i) => {
        const pressed = b.pressed
        const wasPressed = prevButtons.get(i) ?? false
        if (pressed && !wasPressed) {
          // a Settings rebind capture eats the next press; otherwise resolve (nav map first, then user
          // skip binds) and dispatch.
          if (!feedCapture(i)) {
            const cmd = resolveButton(i)
            window.cr?.log(`[gp] btn=${i} cmd=${cmd ?? 'none'}`) // TEMP diagnostics
            if (cmd) dispatch(cmd)
            if ((cmd === 'next' || cmd === 'prev') && location.pathname.startsWith('/watch/')) {
              state.heldSkipBtn = i // start the hold -> continuous scrub
              state.heldSkipCmd = cmd
              skipRepeat.press(now())
            }
          }
        } else if (pressed && wasPressed && i === state.heldSkipBtn) {
          if (skipRepeat.tick(now()) && state.heldSkipCmd) dispatch(state.heldSkipCmd) // repeat while held
        } else if (!pressed && wasPressed && i === state.heldSkipBtn) {
          state.heldSkipBtn = null // released -> stop scrubbing
          skipRepeat.release()
        }
        prevButtons.set(i, pressed)
      })

      // left stick -> direction with hysteresis + accelerating repeat
      const dir = axis.update(pad.axes[0] ?? 0, pad.axes[1] ?? 0)
      if (dir) {
        state.heldDir = dir
        repeat.press(now())
        dispatch(dir)
      }
      const mag = Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0)
      if (mag < 0.3) {
        state.heldDir = null
        repeat.release()
      }
      if (state.heldDir && repeat.tick(now())) dispatch(state.heldDir)
    }
    // A disconnected pad must not leave held buttons or repeat timers behind.
    for (const index of states.keys()) {
      if (!connected.has(index)) states.delete(index)
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKeyLog)
    window.removeEventListener('blur', suspend)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('keydown', onChord, true)
  }
}
