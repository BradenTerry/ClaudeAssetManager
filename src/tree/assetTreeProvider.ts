import * as vscode from 'vscode';
import { ClaudeAsset } from '../core/types';
import { buildTreeNodes, PluginMetadataOptions } from './nodeDescriptors';
import { ContainerNode, PluginFolderNode, GroupNode, AssetNode, WorktreesFolderNode, WorktreeNameFolderNode, TreeNode } from './nodes';
import { ContainerNodeDescriptor } from './nodeDescriptors';

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
      return element.children;
    }
    if (element instanceof WorktreesFolderNode) {
      return element.children;
    }
    if (element instanceof WorktreeNameFolderNode) {
      return element.children;
    }
    if (element instanceof GroupNode) {
      return element.children;
    }
    return [];
  }
}
