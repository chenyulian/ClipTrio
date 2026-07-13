import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { runCommand, stderrLimit } from '../server-process.js';

test('runCommand resolves for a successful subprocess', async () => {
  await assert.doesNotReject(() => runCommand(process.execPath, ['-e', ''], process.cwd(), {
    label: 'node success',
    timeoutMs: 1000
  }));
});

test('runCommand rejects non-zero exits with capped stderr', async () => {
  const noisy = `process.stderr.write('x'.repeat(${stderrLimit + 2000})); process.exit(2);`;
  await assert.rejects(
    () => runCommand(process.execPath, ['-e', noisy], process.cwd(), {
      label: 'node noisy failure',
      timeoutMs: 1000
    }),
    error => {
      assert.equal(error.message.length, stderrLimit);
      assert.match(error.message, /^x+$/);
      return true;
    }
  );
});

test('runCommand rejects and kills timed-out subprocesses', async () => {
  await assert.rejects(
    () => runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000);'], process.cwd(), {
      label: 'node timeout',
      timeoutMs: 50
    }),
    error => {
      assert.equal(error.code, 'ETIMEDOUT');
      assert.match(error.message, /node timeout timed out/);
      return true;
    }
  );
});

test('runCommand rejects and kills a subprocess when its request is aborted', async () => {
  const controller = new AbortController();
  const running = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000);'], process.cwd(), {
    label: 'node aborted work',
    timeoutMs: 1000,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(running, error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.code, 'ABORT_ERR');
    assert.match(error.message, /node aborted work was aborted/);
    return true;
  });
});
