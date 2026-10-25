import { isSteamChordActive } from './steamChord'

// Steam overlays can leave the gamepad connected and reporting buttons while another
// window owns input. Text input from the OSK is still allowed; only app commands stop.
export function appOwnsInput(): boolean {
  return document.visibilityState !== 'hidden' && !isSteamChordActive()
}
