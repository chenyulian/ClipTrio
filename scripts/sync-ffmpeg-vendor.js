import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(rootDir, 'public', 'vendor');

const copies = [
  {
    source: path.join(rootDir, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm'),
    destination: path.join(vendorDir, 'ffmpeg')
  },
  {
    source: path.join(rootDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm'),
    destination: path.join(vendorDir, 'ffmpeg-core')
  }
];

await fsp.rm(vendorDir, { recursive: true, force: true });
await fsp.mkdir(vendorDir, { recursive: true });

for (const { source, destination } of copies) {
  await fsp.cp(source, destination, { recursive: true });
}

console.log('Synced ffmpeg.wasm browser assets to public/vendor.');
