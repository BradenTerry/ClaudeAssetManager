import * as path from 'path';
import { ClaudeAsset } from './types';

/**
 * Derive the display name for a plugin from its file path.
 *
 * Path shapes under ~/.claude/plugins/:
 *   cache/<marketplace>/<PLUGIN>/<version>/...        -> rel[0]=cache,  result=rel[2]
 *   marketplaces/<mk>/(plugins|external_plugins)/<PLUGIN>/...
 *                                                      -> rel[0]=marketplaces, result=rel[3]
 *   <PLUGIN>/...                                       -> result=rel[0]
 *
 * Returns 'unknown' when the plugin name cannot be derived.
 */
export function derivePluginName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const marker = '/plugins/';
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) {
    return 'unknown';
  }

  const afterPlugins = normalized.slice(idx + marker.length);
  if (!afterPlugins) {
    return 'unknown';
  }

  const parts = afterPlugins.split('/').filter(p => p.length > 0);
  if (parts.length === 0) {
    return 'unknown';
  }

  if (parts[0] === 'cache') {
    // cache/<marketplace>/<PLUGIN>/...
    const plugin = parts[2];
    return plugin || 'unknown';
  }

  if (parts[0] === 'marketplaces') {
    // marketplaces/<mk>/(plugins|external_plugins)/<PLUGIN>/...
    const plugin = parts[3];
    return plugin || 'unknown';
  }

  // Direct: <PLUGIN>/...
  return parts[0];
}

/**
 * Result of deriving project identity from a Project- or Registered-scoped asset.
 */
export interface ProjectInfo {
  /** Display name of the project (segment immediately above the first .claude dir). */
  project: string;
  /**
   * The worktree name when this asset lives under
   * <project>/.claude/worktrees/<name>/.claude/...
   * Otherwise null.
   */
  worktree: string | null;
}

/**
 * Derive the project name and optional worktree name for a Project- or Registered-scoped asset.
 *
 * Resolution:
 * 1. Find the FIRST /.claude/ segment in the normalized path.
 *    - project = segment immediately above that .claude (path.basename of the prefix).
 *    - If the segment immediately after .claude is 'worktrees' AND a non-empty name follows:
 *        worktree = that name segment.
 *      Otherwise: worktree = null.
 * 2. If no /.claude/ segment exists (loose asset):
 *    - Fall back to rootPath-relative derivation (same as legacy deriveProjectName).
 *    - worktree = null.
 *
 * Key invariant: uses indexOf (FIRST occurrence), so the second .claude in
 * double-.claude worktree paths never changes the project name.
 */
export function deriveProjectInfo(asset: ClaudeAsset): ProjectInfo {
  const normalized = asset.filePath.replace(/\\/g, '/');
  const claudeMarker = '/.claude/';
  const claudeIdx = normalized.indexOf(claudeMarker);

  if (claudeIdx !== -1) {
    const before = normalized.slice(0, claudeIdx);
    const project = path.basename(before);

    // Parse the segments immediately after the first .claude/
    const afterClaude = normalized.slice(claudeIdx + claudeMarker.length);
    const segments = afterClaude.split('/').filter(s => s.length > 0);

    let worktree: string | null = null;
    if (segments[0] === 'worktrees' && segments[1] && segments[1].length > 0) {
      worktree = segments[1];
    }

    return { project, worktree };
  }

  // Loose asset -- derive from rootPath
  const normalizedRoot = asset.rootPath.replace(/\\/g, '/');
  const fileDir = path.dirname(normalized);
  let rel: string;
  if (fileDir.startsWith(normalizedRoot)) {
    rel = fileDir.slice(normalizedRoot.length).replace(/^\//, '');
  } else {
    rel = '';
  }

  let project: string;
  if (!rel) {
    project = path.basename(asset.rootPath);
  } else {
    const firstSegment = rel.split('/')[0];
    project = firstSegment || path.basename(asset.rootPath);
  }

  return { project, worktree: null };
}

/**
 * Derive the display project name for a Project- or Registered-scoped asset.
 *
 * Delegates to deriveProjectInfo and returns the project field, ensuring
 * consistent behavior with the worktree-aware derivation.
 */
export function deriveProjectName(asset: ClaudeAsset): string {
  return deriveProjectInfo(asset).project;
}

/**
 * True when a Project/Registered asset belongs to the scan root ITSELF rather than a
 * sub-project beneath it -- i.e. its `.claude/` (or root CLAUDE.md) lives directly in the
 * registered/workspace root. Such assets should render flat at the Working Directory root
 * instead of inside a folder named after the root.
 */
export function isRootLevelAsset(asset: ClaudeAsset): boolean {
  const norm = asset.filePath.replace(/\\/g, '/');
  const root = (asset.rootPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root) {
    return false;
  }
  return (
    norm.startsWith(root + '/.claude/') ||
    norm === root + '/.claude' ||
    norm === root + '/CLAUDE.md'
  );
}

/**
 * For a memory asset under ~/.claude/projects/<encoded>/memory/..., return a readable
 * label for the originating project. The <encoded> segment is the project's working
 * directory with "/" replaced by "-" (lossy, so decoding is best-effort).
 *
 * Heuristic: strip the leading "-Users-.../-Projects-" style prefix when present so a
 * path like "-Users-braden-Projects-Sitelume" reads as "Sitelume"; otherwise fall back
 * to the encoded segment with its leading dash removed. Returns 'unknown' if the path
 * has no projects/ segment.
 */
export function deriveMemoryProject(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const marker = '/.claude/projects/';
  const i = norm.indexOf(marker);
  if (i === -1) {
    return 'unknown';
  }
  const seg = norm.slice(i + marker.length).split('/')[0];
  if (!seg) {
    return 'unknown';
  }
  const afterProjects = seg.match(/-Projects-(.+)$/);
  if (afterProjects) {
    return afterProjects[1];
  }
  return seg.replace(/^-/, '');
}
