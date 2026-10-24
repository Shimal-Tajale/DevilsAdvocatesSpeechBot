// Turning a flag off must cleanly hide the nav item, panel, or button.
// Planned-but-off features show a "Coming soon" badge on the home screen.
export const features = {
  modes: { publicSpeaking: true, debate: true, interview: true },
  liveIndicators: true,
  mascotQuestions: true,
  scriptUpload: true,
  noteCards: true,
  cameraPreview: true,
  history: false,
}

export type Features = typeof features
export type ModeId = keyof Features['modes']
