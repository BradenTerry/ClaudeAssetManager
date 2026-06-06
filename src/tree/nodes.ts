import * as vscode from 'vscode';
import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset } from '../core/types';
import {
  NodeKind,
  ContainerNodeDescriptor,
  PluginFolderNodeDescriptor,
  GroupNodeDescriptor,
  AssetNodeDescriptor,
  WorktreesFolderNodeDescriptor,
  WorktreeNameFolderNodeDescriptor
} from './nodeDescriptors';

export type TreeNode = ContainerNode | PluginFolderNode | GroupNode | AssetNode | WorktreesFolderNode | WorktreeNameFolderNode;

export class ContainerNode extends vscode.TreeItem {
  readonly kind = NodeKind.Container;
  readonly containerKind: ContainerNodeDescriptor['containerKind'];
  readonly children: TreeNode[];

  constructor(desc: ContainerNodeDescriptor) {
    super(
      desc.label,
      desc.containerKind === 'working-directory'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.containerKind = desc.containerKind;
    this.contextValue = 'assetContainer';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.children = desc.children.map(child => {
      if (child.kind === NodeKind.Container) {
        return new ContainerNode(child as ContainerNodeDescriptor);
      }
      if (child.kind === NodeKind.PluginFolder) {
        return new PluginFolderNode(child as PluginFolderNodeDescriptor);
      }
      if (child.kind === NodeKind.Asset) {
        return new AssetNode(child as AssetNodeDescriptor);
      }
      if (child.kind === NodeKind.WorktreesFolder) {
        return new WorktreesFolderNode(child as WorktreesFolderNodeDescriptor);
      }
      return new GroupNode(child as GroupNodeDescriptor);
    });
  }
}


export class PluginFolderNode extends vscode.TreeItem {
  readonly kind = NodeKind.PluginFolder;
  readonly pluginName: string;
  readonly children: GroupNode[];

  constructor(desc: PluginFolderNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.pluginName = desc.pluginName;
    this.contextValue = 'assetPluginFolder';
    if (desc.outdated) {
      this.iconPath = new vscode.ThemeIcon('arrow-circle-up');
    } else {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
    if (desc.description !== undefined) {
      this.description = desc.description;
    }
    this.children = desc.children.map(c => new GroupNode(c));
  }
}

export class GroupNode extends vscode.TreeItem {
  readonly kind = NodeKind.Group;
  readonly children: AssetNode[];
  readonly assetType: AssetType;

  constructor(desc: GroupNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.assetType = desc.assetType;
    this.children = desc.children.map(c => new AssetNode(c));
    this.contextValue = 'assetGroup';
  }
}

export class AssetNode extends vscode.TreeItem {
  readonly kind = NodeKind.Asset;
  readonly asset: ClaudeAsset;
  readonly filePath: string;

  constructor(desc: AssetNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.None);
    this.asset = desc.asset;
    this.filePath = desc.filePath;
    this.tooltip = desc.tooltip;
    this.resourceUri = vscode.Uri.file(desc.filePath);
    this.contextValue = desc.contextValue;
    this.command = {
      command: desc.commandId,
      title: 'Open',
      arguments: desc.commandArgs
    };
  }
}

export class WorktreesFolderNode extends vscode.TreeItem {
  readonly kind = NodeKind.WorktreesFolder;
  readonly children: WorktreeNameFolderNode[];

  constructor(desc: WorktreesFolderNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'worktreesFolder';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.children = desc.children.map(c => new WorktreeNameFolderNode(c));
  }
}

export class WorktreeNameFolderNode extends vscode.TreeItem {
  readonly kind = NodeKind.WorktreeNameFolder;
  readonly children: (GroupNode | AssetNode)[];

  constructor(desc: WorktreeNameFolderNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'worktreeNameFolder';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.children = desc.children.map(child => {
      if (child.kind === NodeKind.Asset) {
        return new AssetNode(child as AssetNodeDescriptor);
      }
      return new GroupNode(child as GroupNodeDescriptor);
    });
  }
}
