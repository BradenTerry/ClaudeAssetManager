import * as fs from 'fs';
import * as path from 'path';
import { ClaudeAsset, ScanRoot, ScanOptions, AssetScope, AssetType } from './types';
import { recognizeAssetType, buildAsset } from './assetFactory';

/**
 * Scan all roots and return every recognized ClaudeAsset.
 * Handles symlinks, cycle detection, and noise-dir pruning.
 */
export function scan(roots: ScanRoot[], opts: ScanOptions): ClaudeAsset[] {
  const assets: ClaudeAsset[] = [];
  // visited real paths -- guards against symlink cycles across the entire scan
  const visited = new Set<string>();

  for (const root of roots) {
    // Determine effective scope for files found in this root
    scanDir(root.path, root.scope, root, opts, visited, assets);
  }

  return assets;
}

function resolveRealPath(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function scanDir(
  dirPath: string,
  scope: AssetScope,
  root: ScanRoot,
  opts: ScanOptions,
  visited: Set<string>,
  assets: ClaudeAsset[]
): void {
  // Resolve and guard cycles
  const realPath = resolveRealPath(dirPath);
  if (realPath === null) return; // doesn't exist or unreadable
  if (visited.has(realPath)) return; // cycle or already visited
  visited.add(realPath);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isSymbolicLink()) {
      if (!opts.followSymlinks) continue;

      // Resolve the symlink target
      let targetStat: fs.Stats;
      try {
        targetStat = fs.statSync(entryPath); // follows symlinks
      } catch {
        continue; // broken symlink
      }

      if (targetStat.isDirectory()) {
        // Prune check on the link name itself
        if (opts.excludeDirs.includes(entry.name)) continue;
        // For the global home root, skip top-level plugins/ and projects/ --
        // those subtrees are covered by dedicated scan roots.
        if (isGlobalRootTopLevelPrunedDir(entryPath, dirPath, root)) continue;
        const effectiveScope = deriveScope(entryPath, root, scope);
        scanDir(entryPath, effectiveScope, root, opts, visited, assets);
      } else if (targetStat.isFile()) {
        const effectiveScope = deriveScope(entryPath, root, scope);
        tryAddAsset(entryPath, effectiveScope, root, assets);
      }
    } else if (entry.isDirectory()) {
      if (opts.excludeDirs.includes(entry.name)) continue;
      // For the global home root, skip top-level plugins/ and projects/ --
      // those subtrees are covered by dedicated scan roots.
      if (isGlobalRootTopLevelPrunedDir(entryPath, dirPath, root)) continue;
      const effectiveScope = deriveScope(entryPath, root, scope);
      scanDir(entryPath, effectiveScope, root, opts, visited, assets);
    } else if (entry.isFile()) {
      const effectiveScope = deriveScope(entryPath, root, scope);
      tryAddAsset(entryPath, effectiveScope, root, assets);
    }
  }
}

/**
 * Returns true when we are walking the global home root AND the directory we are
 * about to descend into is a direct child of that root named "plugins" or "projects".
 * Those subtrees are covered by dedicated scan roots (plugins/cache and projects memory),
 * so the global root must not recurse into them.
 *
 * The check is intentionally narrow: it only fires when
 *   - the current scan root is flagged isGlobal, AND
 *   - the parent directory IS the root itself (depth-1 child), AND
 *   - the child directory name is "plugins" or "projects".
 *
 * This avoids wrongly pruning a project directory that happens to be named
 * "plugins" or "projects" inside a workspace or registered root.
 */
function isGlobalRootTopLevelPrunedDir(entryPath: string, parentDirPath: string, root: ScanRoot): boolean {
  if (!root.isGlobal) return false;
  // Only prune at the immediate top level of the global root
  if (parentDirPath !== root.path) return false;
  const name = path.basename(entryPath);
  return name === 'plugins' || name === 'projects';
}

/**
 * Determine the effective scope of a file/dir path given its root context.
 * - If under a plugins root -> Plugin
 * - If root is Global and path contains /plugins/ -> Plugin
 * - If root is Global -> Global
 * - For registered or workspace roots: a path that contains a /.claude/ segment
 *   (or is a project-root CLAUDE.md directly under the root) -> Project;
 *   a genuinely loose asset (no .claude/ segment) -> root's default scope
 */
function deriveScope(filePath: string, root: ScanRoot, defaultScope: AssetScope): AssetScope {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // If this root is the plugins root, everything under it is Plugin scope
  if (root.isPlugins) {
    return AssetScope.Plugin;
  }

  // The memory root (~/.claude/projects) is global Claude data. Its files live under
  // a path containing /.claude/, so without this guard they would be misclassified as
  // Project scope by the rule below. Memory is always Global scope.
  if (root.isMemory) {
    return AssetScope.Global;
  }

  // If this root is the global root, check if we're inside plugins/
  if (root.isGlobal) {
    const normalizedRootPath = root.path.replace(/\\/g, '/');
    const pluginsPrefix = normalizedRootPath + '/plugins/';
    if (normalizedPath.startsWith(pluginsPrefix)) {
      return AssetScope.Plugin;
    }
    return AssetScope.Global;
  }

  // For registered and workspace roots: classify by .claude/ segment presence.
  // A path containing /.claude/ is a project-local asset -> Project scope.
  // A loose asset without .claude/ in the path retains the root's default scope.
  if (normalizedPath.includes('/.claude/') || normalizedPath.endsWith('/.claude')) {
    return AssetScope.Project;
  }

  return defaultScope;
}

function tryAddAsset(filePath: string, scope: AssetScope, root: ScanRoot, assets: ClaudeAsset[]): void {
  const type = recognizeAssetType(filePath);
  if (type === undefined) return;

  // For the global root, exclude assets that are inside the plugins dir
  // (those are handled by the plugins root -- but deduplication by filePath is fine)
  try {
    const asset = buildAsset(filePath, type, scope, root.path);
    assets.push(asset);
  } catch {
    // unreadable or failed -- skip
  }
}
