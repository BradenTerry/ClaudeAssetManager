import * as vscode from 'vscode';
import { ClaudeAsset } from '../core/types';
import { buildTreeNodes, PluginMetadataOptions } from './nodeDescriptors';
import { ContainerNode, PluginFolderNode, GroupNode, AssetNode, WorktreesFolderNode, WorktreeNameFolderNode, TreeNode } from './nodes';
import { ContainerNodeDescriptor } from './nodeDescriptors';

export class AssetTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private assets: ClaudeAsset[] = [];
  private pluginMeta: PluginMetadataOptions | undefined;
  private rootNodes: TreeNode[] = [];

  update(assets: ClaudeAsset[], pluginMeta?: PluginMetadataOptions): void {
    this.assets = assets;
    this.pluginMeta = pluginMeta;
    this.rebuild();
  }

  private rebuild(): void {
    const descriptors = buildTreeNodes(this.assets, this.pluginMeta);
    this.rootNodes = descriptors.map(d => new ContainerNode(d as ContainerNodeDescriptor));
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
