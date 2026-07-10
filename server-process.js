import { spawn } from 'node:child_process';

export const stderrLimit = 12000;
export const defaultProcessTimeoutMs = 120000;
export const defaultProbeTimeoutMs = 30000;

function capOutput(current, chunk, limit = stderrLimit) {
  const next = current + chunk.toString();
  return next.length > limit ? next.slice(-limit) : next;
}

function timeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms.`);
  error.code = 'ETIMEDOUT';
  return error;
}

export function runCommand(command, args, cwd, options = {}) {
  const timeoutMs = options.timeoutMs ?? defaultProcessTimeoutMs;
  const label = options.label || command;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stderr = '';
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(timeoutError(label, timeoutMs)));
    }, timeoutMs);

    child.stderr.on('data', chunk => {
      stderr = capOutput(stderr, chunk);
    });
    child.on('error', error => {
      finish(() => reject(error));
    });
    child.on('close', code => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `${command} exited with code ${code}`));
      });
    });
  });
}

export function probeDuration(command, filePath, cwd, options = {}) {
  const timeoutMs = options.timeoutMs ?? defaultProbeTimeoutMs;

  return new Promise((resolve, reject) => {
    const child = spawn(command, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(timeoutError('FFprobe', timeoutMs)));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout = capOutput(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = capOutput(stderr, chunk);
    });
    child.on('error', error => {
      finish(() => reject(error));
    });
    child.on('close', code => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(stderr || 'Unable to inspect video duration.'));
          return;
        }
        const duration = Number(stdout.trim());
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new Error('Unable to inspect video duration.'));
          return;
        }
        resolve(duration);
      });
    });
  });
}
