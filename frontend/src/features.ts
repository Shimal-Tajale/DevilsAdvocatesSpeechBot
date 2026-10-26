// Turning a flag off must cleanly hide the nav item, panel, or button.
// Planned-but-off features show a "Coming soon" badge on the home screen.
import type { ModeId } from './types'

export const features = {
  modes: { presentation: true, debate: true, interview: true } satisfies Record<ModeId, boolean>,
  liveIndicators: true,
  mascotQuestions: true,
  scriptUpload: true,
  noteCards: true,
  cameraPreview: true,
  history: true,
  // true: api.ts returns mock data. false: api.ts calls the real backend through the Vite proxy.
  useMocks: false,
}
