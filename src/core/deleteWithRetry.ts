/**
 * Cross-platform retry wrapper for filesystem deletes.
 *
 * On Windows a delete can transiently fail with EBUSY/EPERM when another handle
 * is open on the target -- antivirus, the search indexer, or (the common case in
 * this extension) the recursive fs.watch we keep on the .claude tree. Unlike
 * POSIX, Windows refuses to remove a file/dir that still has an open handle, so
 * the delete must be retried after the handle is released. This helper retries
 * such errors a few times with linear backoff; non-retryable errors throw
 * immediately so genuine failures surface fast.
 */

const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

/**
 * Returns true when an error looks like a transient Windows lock worth retrying.
 * Matches both a structured `.code` (Node errors) and the message text, since
 * vscode's FileSystemError wraps the real errno in its message rather than .code.
 */
export function isRetryableDeleteError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_CODES.has(code.toUpperCase())) {
      return true;
    }
  }
  const message = String((err as { message?: unknown })?.message ?? err ?? '');
  return /\b(EBUSY|EPERM|EACCES|ENOTEMPTY)\b/i.test(message);
}

export interface DeleteRetryOptions {
  /** Total attempts including the first try. Default 4. */
  attempts?: number;
  /** Base backoff in ms; attempt N waits delayMs * N. Default 100. */
  delayMs?: number;
  /** Injectable delay so tests run without real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the retry predicate (tests). */
  isRetryable?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Runs `attempt` and retries it while it rejects with a retryable error, up to
 * `attempts` total tries. Re-throws the last error once retries are exhausted or
 * when the error is not retryable.
 */
export async function deleteWithRetry(
  attempt: () => Promise<void>,
  options: DeleteRetryOptions = {}
): Promise<void> {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 100;
  const sleep = options.sleep ?? defaultSleep;
  const isRetryable = options.isRetryable ?? isRetryableDeleteError;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await attempt();
      return;
    } catch (err) {
      lastErr = err;
      const canRetry = i < attempts - 1 && isRetryable(err);
      if (!canRetry) {
        throw err;
      }
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}
