import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerService = process.env.MEDIA_DOCKER_SERVICE || 'clip-trio';
const toolCache = new Map();

function runBuffered(command, args, {
  input,
  stdoutLimit = 64 * 1024 * 1024,
  stderrLimit = 16 * 1024
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) {
        child.kill();
        finish(() => reject(new Error(`${command} produced more than ${stdoutLimit} bytes of output.`)));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on('data', chunk => {
      if (stderrBytes >= stderrLimit) return;
      const remaining = stderrLimit - stderrBytes;
      stderr.push(chunk.subarray(0, remaining));
      stderrBytes += Math.min(chunk.length, remaining);
    });

    child.on('error', error => finish(() => reject(error)));
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') finish(() => reject(error));
    });
    child.on('close', code => finish(() => {
      const stderrText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(stderrText || `${command} exited with code ${code}.`));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: stderrText });
    }));

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function resolveTool(tool) {
  if (toolCache.has(tool)) return toolCache.get(tool);

  const mode = String(process.env.MEDIA_TOOL_MODE || 'auto').toLowerCase();
  const localPath = process.env[tool === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'] || tool;

  if (mode !== 'docker') {
    try {
      await runBuffered(localPath, ['-version'], { stdoutLimit: 1024 * 1024 });
      const resolved = { command: localPath, prefix: [], description: `local ${localPath}` };
      toolCache.set(tool, resolved);
      return resolved;
    } catch (error) {
      if (mode === 'local') {
        throw new Error(`Cannot run local ${tool}: ${error.message}`);
      }
    }
  }

  try {
    const prefix = ['compose', 'exec', '-T', dockerService, tool];
    await runBuffered('docker', [...prefix, '-version'], { stdoutLimit: 1024 * 1024 });
    const resolved = {
      command: 'docker',
      prefix,
      description: `Docker service ${dockerService} (${tool})`
    };
    toolCache.set(tool, resolved);
    return resolved;
  } catch (error) {
    throw new Error(
      `Cannot run ${tool}. Install it locally or start the Docker service with "docker compose up -d --build". ${error.message}`
    );
  }
}

async function runTool(tool, args, options) {
  const invocation = await resolveTool(tool);
  return runBuffered(invocation.command, [...invocation.prefix, ...args], options);
}

export async function runFfmpeg(args, options) {
  return runTool('ffmpeg', args, options);
}

export async function runFfprobe(args, options) {
  return runTool('ffprobe', args, options);
}

export async function describeMediaTools() {
  const [ffmpeg, ffprobe] = await Promise.all([resolveTool('ffmpeg'), resolveTool('ffprobe')]);
  return `${ffmpeg.description}; ${ffprobe.description}`;
}
