export function explainError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  const detail = error instanceof Error ? error.message : String(error);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow camera access for this localhost page in your browser '
        + 'and operating-system privacy settings, then click Start Camera again. ' + detail;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No webcam was found. Connect or enable a camera, then retry. ' + detail;
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The webcam could not be opened. Close other apps using it and check OS permissions. ' + detail;
    case 'OverconstrainedError':
      return 'The camera does not support the requested settings. Try another webcam. ' + detail;
    default:
      return detail + '\nIf model or WASM loading failed, run node demo/setup-assets.mjs from '
        + 'frontend/src/vision, confirm npm ci completed, and reload /demo/. '
        + 'Use a current browser supporting WebAssembly and import maps; see the console for details.';
  }
}
