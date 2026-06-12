import * as vscode from 'vscode';
import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset, TokenUsage } from '../core/types';
import { getSectionInfoByAssetType } from '../core/sectionInfo';
import { describeTokenUsage, tokenUsageTooltip, tokenLegendLines } from '../core/tokenCount';
import {
  NodeKind,
  ContainerNodeDescriptor,
  PluginFolderNodeDescriptor,
  GroupNodeDescriptor,
  AssetNodeDescriptor,
  WorktreesFolderNodeDescriptor,
  WorktreeNameFolderNodeDescriptor
} from './nodeDescriptors';

export type TreeNode = ContainerNode | PluginFolderNode | GroupNode | AssetNode | WorktreesFolderNode | WorktreeNameFolderNode | FsDirNode | FsFileNode | TokenSummaryNode;

/**
 * The section's aggregate token total, rendered as the first row of a view (under
 * the Global / Working Directory header). The label shows the "(a)"/"(d)" totals;
 * hovering reveals the abbreviation legend. The same legend is also one click away
 * from the always-visible info button in the view title bar (see the tokenLegend
 * command), so the abbreviations are explained without making the row clickable.
 */
export class TokenSummaryNode extends vscode.TreeItem {
  readonly kind = NodeKind.TokenSummary;

  constructor(usage: TokenUsage) {
    super(describeTokenUsage(usage) ?? '', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tokenSummary';
    this.tooltip = new vscode.MarkdownString(tokenLegendLines().join('  \n'));
  }
}

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
    // Append the enabled-plugin token total to the plugins root / marketplace summary.
    const usage = describeTokenUsage(desc.tokenTotals);
    const descParts = [desc.description, usage].filter((p): p is string => !!p);
    if (descParts.length) {
      this.description = descParts.join(' · ');
    }
    const legend = tokenUsageTooltip(desc.tokenTotals);
    if (legend) {
      this.tooltip = this.tooltip ? `${String(this.tooltip)}\n\n${legend}` : legend;
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
    const baseTooltip = desc.tooltip ?? desc.dirPath;
    const legend = tokenUsageTooltip(desc.tokenTotals);
    if (baseTooltip !== undefined || legend !== undefined) {
      this.tooltip = [baseTooltip, legend].filter(Boolean).join('\n\n');
    }
    // Append the (enabled) plugin's token total to its version/status line.
    const usage = describeTokenUsage(desc.tokenTotals);
    const descParts = [desc.description, usage].filter((p): p is string => !!p);
    if (descParts.length) {
      this.description = descParts.join(' · ');
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
  /** The segment directory where new assets of this type should be created. */
  readonly createTargetDir: string | undefined;

  constructor(desc: GroupNodeDescriptor) {
    super(desc.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.assetType = desc.assetType;
    this.dirPath = desc.dirPath;
    this.createTargetDir = desc.createTargetDir;
    this.children = desc.children.map(c => new AssetNode(c));
    const total = describeTokenUsage(desc.tokenTotals);
    if (total !== undefined) {
      this.description = total;
    }
    switch (desc.assetType) {
      case AssetType.Skill:
        this.contextValue = 'assetGroupSkills';
        break;
      case AssetType.Subagent:
        this.contextValue = 'assetGroupAgents';
        break;
      case AssetType.Command:
        this.contextValue = 'assetGroupCommands';
        break;
      case AssetType.Workflow:
        this.contextValue = 'assetGroupWorkflows';
        break;
      case AssetType.Memory:
        this.contextValue = 'assetGroupMemory';
        break;
      default:
        this.contextValue = 'assetGroup';
    }
    const info = getSectionInfoByAssetType(desc.assetType);
    const legend = tokenUsageTooltip(desc.tokenTotals);
    if (info) {
      const md = new vscode.MarkdownString(`**${info.title}** — ${info.summary}\n\n[Learn more](${info.docUrl})`);
      md.isTrusted = true;
      if (legend) {
        md.appendMarkdown(`\n\n${legend.split('\n').join('  \n')}`);
      }
      this.tooltip = md;
    } else if (legend) {
      this.tooltip = legend;
    }
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
  constructor(dirPath: string, label: string, underPlugins = false, tokenUsage?: TokenUsage) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.dirPath = dirPath;
    this.resourceUri = vscode.Uri.file(dirPath);
    this.contextValue = underPlugins ? 'fsDirPlugin' : 'fsDir';
    const usage = describeTokenUsage(tokenUsage);
    if (usage !== undefined) {
      this.description = usage;
    }
    const legend = tokenUsageTooltip(tokenUsage);
    this.tooltip = legend ? `${dirPath}\n\n${legend}` : dirPath;
  }
}

/** A real file rendered live from the filesystem. Label keeps the extension. */
export class FsFileNode extends vscode.TreeItem {
  readonly kind = NodeKind.FsFile;
  readonly filePath: string;

  constructor(filePath: string, label: string, underPlugins = false, tokenUsage?: TokenUsage) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.filePath = filePath;
    this.resourceUri = vscode.Uri.file(filePath);
    const usage = describeTokenUsage(tokenUsage);
    if (usage !== undefined) {
      this.description = usage;
    }
    const legend = tokenUsageTooltip(tokenUsage);
    this.tooltip = legend ? `${filePath}\n\n${legend}` : filePath;
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
    this.resourceUri = vscode.Uri.file(desc.filePath);
    this.contextValue = desc.contextValue;
    const usage = describeTokenUsage(desc.tokenUsage);
    if (usage !== undefined) {
      this.description = usage;
    }
    const legend = tokenUsageTooltip(desc.tokenUsage);
    this.tooltip = legend ? `${desc.tooltip}\n\n${legend}` : desc.tooltip;
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
