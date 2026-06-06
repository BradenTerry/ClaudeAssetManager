import * as path from 'path';
import { AssetScope, ScanRoot } from './types';

/**
 * Build the list of scan roots from the injected parameters.
 *
 * @param homeClaudeDir  Absolute path to ~/.claude (injected, never read from env in core)
 * @param registeredDirs User-configured additional dirs (claudeAssets.directories)
 * @param workspaceDirs  Open workspace folders
 */
export function buildScanRoots(
  homeClaudeDir: string,
  registeredDirs: string[],
  workspaceDirs: string[]
): ScanRoot[] {
  const roots: ScanRoot[] = [];

  // 1. Global ~/.claude -- Global scope
  roots.push({
    path: homeClaudeDir,
    scope: AssetScope.Global,
    isGlobal: true
  });

  // 2. Plugins cache sub-dir -- Plugin scope (installed plugins only)
  roots.push({
    path: path.join(homeClaudeDir, 'plugins', 'cache'),
    scope: AssetScope.Plugin,
    isPlugins: true
  });

  // 3. Memory under projects/*/  -- Global scope (memory belongs to global claude data)
  //    We include the projects dir as a Global-scoped root; the scanner will treat
  //    files under memory/ dirs as Memory type
  roots.push({
    path: path.join(homeClaudeDir, 'projects'),
    scope: AssetScope.Global,
    isMemory: true
  });

  // 4. Workspace dirs -- Project scope
  for (const wsDir of workspaceDirs) {
    roots.push({
      path: wsDir,
      scope: AssetScope.Project
    });
  }

  // 5. Registered dirs -- Registered scope
  for (const regDir of registeredDirs) {
    roots.push({
      path: regDir,
      scope: AssetScope.Registered
    });
  }

  return roots;
}
