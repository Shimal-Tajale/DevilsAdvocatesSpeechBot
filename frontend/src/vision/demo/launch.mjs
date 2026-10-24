import { spawn, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setupAssets } from './setup-assets.mjs';

const visionRoot = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

try {
  await access(compiler).catch(() => {
    throw new Error('Dependencies are missing. Run npm ci from frontend/src/vision first.');
  });
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (python.error || python.status !== 0) throw new Error('Python 3 is required for the local HTTP server.');
  const build = spawnSync(process.execPath, [compiler, '-p', 'demo/tsconfig.json'], {
    cwd: visionRoot, stdio: 'inherit',
  });
  if (build.error || build.status !== 0) throw new Error('Demo TypeScript compilation failed.');
  await setupAssets();
  console.log('\nOpen http://127.0.0.1:5173/demo/ and click Start Camera. Press Ctrl+C to stop the server.');
  const server = spawn('python3', ['-m', 'http.server', '5173', '--bind', '127.0.0.1',
    '--directory', visionRoot], { stdio: 'inherit' });
  server.on('error', error => { console.error('Local server failed:', error); process.exitCode = 1; });
  server.on('exit', (code, signal) => { process.exitCode = signal === 'SIGINT' ? 0 : (code ?? 0); });
  // Child shares the terminal's process group and receives Ctrl+C as well.
  process.on('SIGINT', () => { server.kill('SIGINT'); });
  process.on('SIGTERM', () => { server.kill('SIGTERM'); });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
