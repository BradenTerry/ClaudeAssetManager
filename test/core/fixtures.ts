import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Creates a temporary directory for a test and returns its path.
 * Call cleanup() when done.
 */
export function makeTempDir(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-assets-test-'));
  return {
    root,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Write a file, creating parent dirs as needed.
 */
export function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Create a directory (and parents).
 */
export function mkdir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Attempt to create a symlink. Returns true if successful, false if
 * the OS forbids it (e.g. Windows without elevated privileges).
 */
export function trySymlink(target: string, linkPath: string): boolean {
  try {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a minimal global ~/.claude structure under the given root.
 */
export function buildGlobalClaudeDir(root: string): void {
  mkdir(root);
  mkdir(path.join(root, 'skills'));
  mkdir(path.join(root, 'agents'));
  mkdir(path.join(root, 'commands'));
  mkdir(path.join(root, 'plugins'));
  mkdir(path.join(root, 'projects'));
}
