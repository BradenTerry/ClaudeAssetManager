import * as assert from 'assert';
import { isRetryableDeleteError, deleteWithRetry } from '../../src/core/deleteWithRetry';

// A sleep that records its calls and never touches a real timer, so the retry
// loop is fully deterministic and instant.
function fakeSleep(): { fn: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return { fn: (ms: number) => { calls.push(ms); return Promise.resolve(); }, calls };
}

function errWithCode(code: string): Error {
  const e = new Error(`${code}: simulated`);
  (e as Error & { code?: string }).code = code;
  return e;
}

// ---------------------------------------------------------------------------
// AC1: isRetryableDeleteError
// ---------------------------------------------------------------------------

describe('isRetryableDeleteError -- AC1', () => {
  it('true for a structured EBUSY code', () => {
    assert.strictEqual(isRetryableDeleteError(errWithCode('EBUSY')), true);
  });

  it('true for EPERM, EACCES, ENOTEMPTY codes', () => {
    assert.strictEqual(isRetryableDeleteError(errWithCode('EPERM')), true);
    assert.strictEqual(isRetryableDeleteError(errWithCode('EACCES')), true);
    assert.strictEqual(isRetryableDeleteError(errWithCode('ENOTEMPTY')), true);
  });

  it('true when the errno is only in the message (vscode FileSystemError style)', () => {
    // vscode wraps the real errno in the message, not .code.
    assert.strictEqual(isRetryableDeleteError(new Error('EBUSY: resource busy or locked, unlink')), true);
  });

  it('false for ENOENT (already gone -- nothing to retry)', () => {
    assert.strictEqual(isRetryableDeleteError(errWithCode('ENOENT')), false);
  });

  it('false for an unrelated error', () => {
    assert.strictEqual(isRetryableDeleteError(new Error('disk on fire')), false);
  });

  it('false for null / undefined / non-error values', () => {
    assert.strictEqual(isRetryableDeleteError(null), false);
    assert.strictEqual(isRetryableDeleteError(undefined), false);
    assert.strictEqual(isRetryableDeleteError(42), false);
  });
});

// ---------------------------------------------------------------------------
// AC2: deleteWithRetry success paths
// ---------------------------------------------------------------------------

describe('deleteWithRetry -- AC2 (success)', () => {
  it('calls attempt once and does not sleep when it succeeds first try', async () => {
    let calls = 0;
    const sleep = fakeSleep();
    await deleteWithRetry(async () => { calls++; }, { sleep: sleep.fn });
    assert.strictEqual(calls, 1);
    assert.strictEqual(sleep.calls.length, 0, 'no sleep on first-try success');
  });

  it('retries a transient EBUSY then succeeds', async () => {
    let calls = 0;
    const sleep = fakeSleep();
    await deleteWithRetry(
      async () => {
        calls++;
        if (calls < 3) throw errWithCode('EBUSY');
      },
      { attempts: 4, delayMs: 50, sleep: sleep.fn }
    );
    assert.strictEqual(calls, 3, 'should have retried until the 3rd attempt succeeded');
    // Slept after attempt 1 and attempt 2 -> linear backoff 50, 100.
    assert.deepStrictEqual(sleep.calls, [50, 100]);
  });
});

// ---------------------------------------------------------------------------
// AC3: deleteWithRetry failure paths
// ---------------------------------------------------------------------------

describe('deleteWithRetry -- AC3 (failure)', () => {
  it('gives up after `attempts` retryable failures and throws the last error', async () => {
    let calls = 0;
    const sleep = fakeSleep();
    await assert.rejects(
      deleteWithRetry(
        async () => { calls++; throw errWithCode('EPERM'); },
        { attempts: 4, delayMs: 10, sleep: sleep.fn }
      ),
      /EPERM/
    );
    assert.strictEqual(calls, 4, 'should attempt exactly `attempts` times');
    assert.strictEqual(sleep.calls.length, 3, 'sleeps between attempts only (n-1)');
  });

  it('does NOT retry a non-retryable error -- throws after one attempt', async () => {
    let calls = 0;
    const sleep = fakeSleep();
    await assert.rejects(
      deleteWithRetry(
        async () => { calls++; throw errWithCode('ENOENT'); },
        { attempts: 4, sleep: sleep.fn }
      ),
      /ENOENT/
    );
    assert.strictEqual(calls, 1, 'non-retryable error must not be retried');
    assert.strictEqual(sleep.calls.length, 0);
  });

  it('honours a custom isRetryable predicate', async () => {
    let calls = 0;
    await assert.rejects(
      deleteWithRetry(
        async () => { calls++; throw new Error('nope'); },
        { attempts: 3, sleep: () => Promise.resolve(), isRetryable: () => true }
      ),
      /nope/
    );
    assert.strictEqual(calls, 3, 'custom predicate should drive retries to exhaustion');
  });
});
