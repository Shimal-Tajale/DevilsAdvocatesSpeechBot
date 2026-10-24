import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Versioned model bundles used in Google's official MediaPipe samples:
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md
const models = {
  'pose_landmarker_lite.task': 'pose_landmarker/pose_landmarker_lite/float16/1',
  'face_landmarker.task': 'face_landmarker/face_landmarker/float16/1',
};

export async function setupAssets() {
  const directory = new URL('./assets/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const [name, model] of Object.entries(models)) {
    const destination = new URL(name, directory);
    // Skip existing bundles; downloads are committed to disk only when complete.
    if ((await stat(destination).catch(() => null))?.size > 1_000_000) continue;
    const url = `https://storage.googleapis.com/mediapipe-models/${model}/${name}`;
    console.log(`Downloading ${name}…`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 1_000_000) throw new Error(`Unexpectedly small model bundle: ${url}`);
    const temporary = new URL(`${name}.partial`, directory);
    await writeFile(temporary, data);
    await rename(temporary, destination);
  }
  console.log(`Models ready in ${fileURLToPath(directory)}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  setupAssets().catch(error => {
    console.error('Model setup failed. Check your internet connection and retry:', error);
    process.exitCode = 1;
  });
}
