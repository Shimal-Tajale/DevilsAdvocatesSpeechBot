import { cp, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('@mediapipe/tasks-vision'));
const destination = new URL('../public/vision/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(join(packageRoot, 'wasm'), new URL('wasm/', destination), { recursive: true });

const models = {
  'pose_landmarker_lite.task': 'pose_landmarker/pose_landmarker_lite/float16/1',
  'face_landmarker.task': 'face_landmarker/face_landmarker/float16/1',
};
for (const [name, model] of Object.entries(models)) {
  const target = new URL(name, destination);
  if ((await stat(target).catch(() => null))?.size > 1_000_000) continue;
  const cached = new URL(`../src/vision/demo/assets/${name}`, import.meta.url);
  if ((await stat(cached).catch(() => null))?.size > 1_000_000) {
    await cp(cached, target);
    continue;
  }
  const response = await fetch(`https://storage.googleapis.com/mediapipe-models/${model}/${name}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Downloading ${name}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 1_000_000) throw new Error(`Invalid model bundle: ${name}`);
  const temporary = new URL(`${name}.partial`, destination);
  await writeFile(temporary, data);
  await rename(temporary, target);
}
