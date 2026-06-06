import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAsset } from '../core/types';
import { buildTreeNodes, PluginMetadataOptions } from './nodeDescriptors';
import { ContainerNode, PluginFolderNode, GroupNode, AssetNode, WorktreesFolderNode, WorktreeNameFolderNode, FsDirNode, FsFileNode, TreeNode } from './nodes';
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

function listDirectory(dirPath: string): TreeNode[] {
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
      dirs.push(new FsDirNode(full, name, underPlugins));
    } else if (stat.isFile()) {
      files.push(new FsFileNode(full, name, underPlugins));
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

  constructor(private readonly section: 'global' | 'working-directory') {}

  update(assets: ClaudeAsset[], pluginMeta?: PluginMetadataOptions): void {
    this.assets = assets;
    this.pluginMeta = pluginMeta;
    this.rebuild();
  }

  private rebuild(): void {
    const descriptors = buildTreeNodes(this.assets, this.pluginMeta);
    const container = descriptors.find(d => d.containerKind === this.section);
    // The section header IS the container; show its children as this view's roots.
    this.rootNodes = container ? new ContainerNode(container as ContainerNodeDescriptor).children : [];
    this._onDidChangeTreeData.fire(null);
  }

  refresh(): void {
    // Called externally when the scan re-runs; caller provides new data via update()
    this._onDidChangeTreeData.fire(null);
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
      return element.dirPath ? listDirectory(element.dirPath) : element.children;
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
      return element.dirPath ? listDirectory(element.dirPath) : element.children;
    }
    if (element instanceof FsDirNode) {
      return listDirectory(element.dirPath);
    }
    if (element instanceof FsFileNode) {
      return [];
    }
    return [];
  }
}
