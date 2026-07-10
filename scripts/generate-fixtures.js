import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFfmpeg, describeMediaTools } from './media-tools.js';
import { fixtureDuration, fixtureHeight, fixtureWidth, fixtures } from './smoke-core.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixtureDir = path.join(repoRoot, 'tmp', 'smoke-fixtures');

function buildColorFilter(colors) {
  return colors.slice(1).map((color, index) => (
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x${color}:t=fill:enable=gte(t\\,${index + 1})`
  )).join(',');
}

export async function generateFixtures({ force = false } = {}) {
  await fsp.mkdir(fixtureDir, { recursive: true });
  const generated = [];

  for (const fixture of fixtures) {
    const outputPath = path.join(fixtureDir, fixture.filename);
    const existing = await fsp.stat(outputPath).catch(() => null);
    if (!force && existing?.size > 1024) {
      generated.push({ ...fixture, path: outputPath, size: existing.size, reused: true });
      continue;
    }

    const filter = buildColorFilter(fixture.colors);
    const { stdout } = await runFfmpeg([
      '-v', 'error',
      '-f', 'lavfi',
      '-i', `color=c=0x${fixture.colors[0]}:s=${fixtureWidth}x${fixtureHeight}:r=30:d=${fixtureDuration}`,
      '-vf', filter,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-crf', '12',
      '-g', '30',
      '-movflags', '+frag_keyframe+empty_moov',
      '-f', 'mp4',
      'pipe:1'
    ], { stdoutLimit: 32 * 1024 * 1024 });

    if (stdout.length < 1024) throw new Error(`Generated fixture ${fixture.filename} is unexpectedly small.`);
    await fsp.writeFile(outputPath, stdout);
    generated.push({ ...fixture, path: outputPath, size: stdout.length, reused: false });
  }

  return generated;
}

async function main() {
  const force = process.argv.includes('--force-fixtures');
  console.log(`Media tools: ${await describeMediaTools()}`);
  const generated = await generateFixtures({ force });
  generated.forEach(item => {
    console.log(`${item.reused ? 'Reused' : 'Generated'} ${path.relative(repoRoot, item.path)} (${item.size} bytes)`);
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`Fixture generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
