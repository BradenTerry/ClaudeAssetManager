import * as fs from 'fs';
import { ScanRoot } from '../core/types';

type OnChangeCallback = () => void;

/**
 * Watch scan roots for filesystem changes and invoke the callback (debounced).
 * Returns a dispose function to stop watching.
 */
export function watchRoots(roots: ScanRoot[], onChange: OnChangeCallback, debounceMs = 300): () => void {
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleChange = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, debounceMs);
  };

  for (const root of roots) {
    try {
      const watcher = fs.watch(root.path, { recursive: true }, () => {
        scheduleChange();
      });
      watcher.on('error', () => {
        // Silently ignore -- path may not exist yet
      });
      watchers.push(watcher);
    } catch {
      // Path does not exist or watch failed -- skip
    }
  }

  return (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
  };
}
