import * as fs from 'fs';
import * as path from 'path';

/**
 * Why a delete was refused before any confirmation prompt was shown.
 *   - 'no-path'         : the command had no resolvable target path.
 *   - 'plugins-managed' : the target lives inside the Claude-managed plugins tree.
 *   - 'not-found'       : the target no longer exists on disk.
 */
export type DeleteRefusal = 'no-path' | 'plugins-managed' | 'not-found';

export interface DeletePlan {
  /** True when the caller may proceed to confirm + delete. */
  ok: boolean;
  /** Set when ok is false; explains why the delete will not proceed. */
  refusal?: DeleteRefusal;
  /** The resolved target path, echoed back when known. */
  targetPath?: string;
  /** Basename of the target, set only when ok is true. */
  name?: string;
  /** Whether the target is a file or a folder, set only when ok is true. */
  kind?: 'file' | 'folder';
}

/**
 * Returns true when targetPath is the plugins root itself or sits inside it.
 * Plugin files are managed by Claude, so the delete command must refuse them.
 */
export function isInsidePluginsTree(targetPath: string, pluginsRoot: string): boolean {
  return targetPath === pluginsRoot || targetPath.startsWith(pluginsRoot + path.sep);
}

/**
 * Pure decision logic for the deleteFile command, extracted so it can be tested
 * without the vscode runtime. Determines whether a delete may proceed and, if so,
 * the metadata needed to build the confirmation prompt. The caller is responsible
 * for showing the confirmation and performing the actual (trash) deletion.
 */
export function planDelete(targetPath: string | undefined, pluginsRoot: string): DeletePlan {
  if (!targetPath) {
    return { ok: false, refusal: 'no-path' };
  }
  if (isInsidePluginsTree(targetPath, pluginsRoot)) {
    return { ok: false, refusal: 'plugins-managed', targetPath };
  }
  let isDir: boolean;
  try {
    isDir = fs.statSync(targetPath).isDirectory();
  } catch {
    return { ok: false, refusal: 'not-found', targetPath };
  }
  return {
    ok: true,
    targetPath,
    name: path.basename(targetPath),
    kind: isDir ? 'folder' : 'file'
  };
}

/** Detail line shown in the delete confirmation dialog. */
export function deleteConfirmDetail(targetPath: string): string {
  return `${targetPath}\n\nThis moves it to the trash.`;
}
