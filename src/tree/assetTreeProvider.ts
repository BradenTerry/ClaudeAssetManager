import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAsset, AssetScope, TokenUsage } from '../core/types';
import { sumTokenUsage, estimateTokens } from '../core/tokenCount';
import { getShowTokenUsage, getShowWorktrees } from '../services/settings';
import { deriveProjectInfo } from '../core/containerDerivations';
import { buildTreeNodes, PluginMetadataOptions } from './nodeDescriptors';
import { ContainerNode, PluginFolderNode, GroupNode, AssetNode, WorktreesFolderNode, WorktreeNameFolderNode, FsDirNode, FsFileNode, TokenSummaryNode, TreeNode } from './nodes';
import { ContainerNodeDescriptor } from './nodeDescriptors';

/**
 * List a real directory's contents as tree nodes: subdirectories first (alpha),
 * then files (alpha), each label keeping its full name and extension. Symlinks
 * are resolved so linked dirs/files render correctly. Returns [] if unreadable.
 */
const PLUGINS_ROOT = path.join(os.homedir(), '.claude', 'plugins');

/** True when a path lives inside the Claude-managed plugins tree (Uninstall, not Delete). */
function isUnderPlugins(p: string): boolean {
  return p === PLUGINS_ROOT || p.startsWith(PLUGINS_ROOT + path.sep);
}

// Extensions we never tokenize (binary/non-text); a token count over raw bytes is meaningless.
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg', '.pdf',
  '.zip', '.gz', '.tgz', '.tar', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.wav', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.wasm', '.class', '.jar', '.pyc'
]);

/**
 * On-demand token usage for a non-asset file (a skill/agent reference, a script, etc.):
 * Claude reads these only when it uses the surrounding asset, so the whole file counts
 * as on-demand (rest), with nothing always-loaded. Skips binary and very large files.
 */
function fallbackFileTokens(full: string, sizeBytes: number): TokenUsage | undefined {
  if (BINARY_EXTS.has(path.extname(full).toLowerCase())) return undefined;
  if (sizeBytes > 2_000_000) return undefined;
  try {
    const rest = estimateTokens(fs.readFileSync(full, 'utf8'));
    return rest > 0 ? { upfront: 0, rest, total: rest } : undefined;
  } catch {
    return undefined;
  }
}

function listDirectory(dirPath: string, tokenMap?: Map<string, TokenUsage>): TreeNode[] {
  let names: string[];
  try {
    names = fs.readdirSync(dirPath);
  } catch {
    return [];
  }
  const dirs: FsDirNode[] = [];
  const files: FsFileNode[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    // Skip dotfiles/dotdirs (e.g. .DS_Store, .git) -- noise, not assets.
    if (name.startsWith('.')) {
      continue;
    }
    const full = path.join(dirPath, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full); // follows symlinks
    } catch {
      continue;
    }
    const underPlugins = isUnderPlugins(full);
    if (stat.isDirectory()) {
      // A skill folder's token cost lives on its SKILL.md asset.
      const skillUsage = tokenMap?.get(path.join(full, 'SKILL.md'));
      dirs.push(new FsDirNode(full, name, underPlugins, skillUsage));
    } else if (stat.isFile()) {
      // tokenMap present = section display on. Recognized assets use their precomputed
      // split; other files (references, scripts) get an on-demand estimate.
      const usage = tokenMap
        ? tokenMap.get(full) ?? fallbackFileTokens(full, stat.size)
        : undefined;
      files.push(new FsFileNode(full, name, underPlugins, usage));
    }
  }
  return [...dirs, ...files];
}

/**
 * Backs a single sidebar section (its own view). `section` selects which top-level
 * container's CHILDREN become the roots of this view, so "Global" and "Working Directory"
 * render as separate collapsible sections rather than nodes inside one tree.
 */
export class AssetTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private assets: ClaudeAsset[] = [];
  private pluginMeta: PluginMetadataOptions | undefined;
  private rootNodes: TreeNode[] = [];
  // filePath -> token usage, so live fs nodes (Skills/Agents) show the same
  // numbers computed once at scan time. undefined when this section's toggle is off,
  // which also suppresses the on-demand fallback for non-asset files.
  private tokenMap: Map<string, TokenUsage> | undefined = new Map();

  constructor(private readonly section: 'global' | 'working-directory') {}

  update(assets: ClaudeAsset[], pluginMeta?: PluginMetadataOptions): void {
    this.assets = assets;
    this.pluginMeta = pluginMeta;
    // Token display is per-section; when this section's toggle is off, the fs nodes
    // (Skills/Agents) get an empty map and the descriptor build strips the rest.
    const showTokens = getShowTokenUsage(this.section);
    this.tokenMap = showTokens
      ? new Map(assets.filter(a => a.tokenUsage).map(a => [a.filePath, a.tokenUsage as TokenUsage]))
      : undefined;
    this.rebuild(showTokens);
  }

  private rebuild(showTokens = getShowTokenUsage(this.section)): void {
    // Worktrees are a Working Directory concern only; hide their assets (and so the
    // "worktrees" folder) unless the section's toggle is on. Global has no worktrees.
    const assetsForTree =
      this.section === 'working-directory' && !getShowWorktrees()
        ? this.assets.filter(a => deriveProjectInfo(a).worktree === null)
        : this.assets;
    const descriptors = buildTreeNodes(assetsForTree, this.pluginMeta, showTokens);
    const container = descriptors.find(d => d.containerKind === this.section);
    // The section header IS the container; show its children as this view's roots.
    const children = container ? new ContainerNode(container as ContainerNodeDescriptor).children : [];

    // When token display is on, lead with a summary row (info icon + (a)/(d) legend
    // tooltip) showing this section's aggregate total. Skipped when there is nothing to count.
    const summary = this.getContextSummary();
    this.rootNodes = showTokens && summary.total > 0
      ? [new TokenSummaryNode(summary), ...children]
      : children;
    this._onDidChangeTreeData.fire(null);
  }

  refresh(): void {
    // Called externally when the scan re-runs; caller provides new data via update()
    this._onDidChangeTreeData.fire(null);
  }

  /**
   * Total token usage of the assets shown in this section, for the view banner.
   * Global → global-scoped assets; Working Directory → everything that is neither
   * global nor plugin (project/registered/root). Plugin assets are excluded (their
   * loaded cost depends on enablement, surfaced separately). Worktree assets are
   * excluded too: other worktrees are separate checkouts (and usually duplicate the
   * main CLAUDE.md/agents), so they are not part of the active context's loaded cost
   * -- counting them double-billed the banner relative to the visible main tree.
   */
  getContextSummary(): TokenUsage {
    const inSection = (a: ClaudeAsset): boolean => {
      if (this.section === 'global') return a.scope === AssetScope.Global;
      if (a.scope === AssetScope.Global || a.scope === AssetScope.Plugin) return false;
      // Worktree copies live under a "worktrees" folder in the tree, not the active context.
      return deriveProjectInfo(a).worktree === null;
    };
    return sumTokenUsage(this.assets.filter(inSection).map(a => a.tokenUsage));
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.rootNodes;
    }
    if (element instanceof ContainerNode) {
      return element.children;
    }
    if (element instanceof PluginFolderNode) {
      // Metadata-driven folders mirror the plugin's install directory; the asset-derived
      // fallback uses precomputed type-group children.
      return element.dirPath ? listDirectory(element.dirPath, this.tokenMap) : element.children;
    }
    if (element instanceof WorktreesFolderNode) {
      return element.children;
    }
    if (element instanceof WorktreeNameFolderNode) {
      return element.children;
    }
    if (element instanceof GroupNode) {
      // Skills/Agents groups mirror a real directory; everything else uses
      // the precomputed asset children.
      return element.dirPath ? listDirectory(element.dirPath, this.tokenMap) : element.children;
    }
    if (element instanceof FsDirNode) {
      return listDirectory(element.dirPath, this.tokenMap);
    }
    if (element instanceof FsFileNode) {
      return [];
    }
    return [];
  }
}
