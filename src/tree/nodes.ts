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

export type TreeNode = ContainerNode | PluginFolderNode | GroupNode | AssetNode | WorktreesFolderNode | WorktreeNameFolderNode | FsDirNode | FsFileNode;

export class ContainerNode extends vscode.TreeItem {
  readonly kind = NodeKind.Container;
  readonly containerKind: ContainerNodeDescriptor['containerKind'];
  readonly children: TreeNode[];

  constructor(desc: ContainerNodeDescriptor) {
    const collapsible = desc.containerKind === 'working-directory'
      ? vscode.TreeItemCollapsibleState.Expanded
      : (desc.containerKind === 'marketplace' && desc.children.length === 0
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed);
    super(desc.label, collapsible);
    this.containerKind = desc.containerKind;
    this.contextValue = desc.contextValue ?? 'assetContainer';
    this.iconPath = new vscode.ThemeIcon('folder');
    if (desc.dirPath !== undefined) {
      this.resourceUri = vscode.Uri.file(desc.dirPath);
      this.tooltip = desc.dirPath;
    }
    if (desc.description !== undefined) {
      this.description = desc.description;
    }
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
  readonly pluginId: string | undefined;
  /** When set, children are listed lazily from this real install directory. */
  readonly dirPath: string | undefined;
  readonly children: GroupNode[];
  /** Scope of this plugin's enablement entry (project-scoped plugins only). */
  readonly scope: 'project' | 'local' | undefined;

  constructor(desc: PluginFolderNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.pluginName = desc.pluginName;
    this.pluginId = desc.pluginId;
    this.dirPath = desc.dirPath;
    this.scope = desc.scope;
    const enTok = desc.enabled === false ? 'Disabled' : 'Enabled';
    const outTok = desc.outdated ? 'Outdated' : '';
    this.contextValue = desc.contextValue ?? `assetPluginFolder${enTok}${outTok}`;
    if (desc.enabled === false) {
      this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    } else if (desc.enabled === true) {
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
    if (desc.tooltip !== undefined) {
      this.tooltip = desc.tooltip;
    } else if (desc.dirPath !== undefined) {
      this.tooltip = desc.dirPath;
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
  /** When set, children are listed lazily from this real directory (Skills, Agents). */
  readonly dirPath: string | undefined;

  constructor(desc: GroupNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.assetType = desc.assetType;
    this.dirPath = desc.dirPath;
    this.children = desc.children.map(c => new AssetNode(c));
    this.contextValue = 'assetGroup';
  }
}

/**
 * A real directory rendered live from the filesystem (a skill folder, or any
 * subdirectory beneath a Skills/Agents tree). Children are listed lazily by the
 * tree provider when expanded.
 */
export class FsDirNode extends vscode.TreeItem {
  readonly kind = NodeKind.FsDir;
  readonly dirPath: string;

  // `underPlugins` entries are Claude-managed (use Uninstall, not Delete) -> a distinct
  // contextValue keeps them out of the Delete menu while still allowing Reveal.
  constructor(dirPath: string, label: string, underPlugins = false) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.dirPath = dirPath;
    this.resourceUri = vscode.Uri.file(dirPath);
    this.tooltip = dirPath;
    this.contextValue = underPlugins ? 'fsDirPlugin' : 'fsDir';
  }
}

/** A real file rendered live from the filesystem. Label keeps the extension. */
export class FsFileNode extends vscode.TreeItem {
  readonly kind = NodeKind.FsFile;
  readonly filePath: string;

  constructor(filePath: string, label: string, underPlugins = false) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.filePath = filePath;
    this.resourceUri = vscode.Uri.file(filePath);
    this.tooltip = filePath;
    const isMarkdown = label.toLowerCase().endsWith('.md');
    this.contextValue = isMarkdown
      ? (underPlugins ? 'fsFileMdPlugin' : 'fsFileMd')
      : (underPlugins ? 'fsFilePlugin' : 'fsFile');
    // Open with the user's default editor; "Open Preview" stays in the context menu for .md.
    this.command = {
      command: isMarkdown ? 'claudeAssets.openMarkdown' : 'claudeAssets.openDefault',
      title: 'Open',
      arguments: [filePath]
    };
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
