import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset } from '../core/types';
import { InstalledPluginInfo } from '../core/pluginMetadata';
import { derivePluginName, deriveProjectInfo, deriveMemoryProject } from '../core/containerDerivations';

export enum NodeKind {
  Container = 'Container',
  PluginFolder = 'PluginFolder',
  Group = 'Group',
  Asset = 'Asset',
  WorktreesFolder = 'WorktreesFolder',
  WorktreeNameFolder = 'WorktreeNameFolder'
}

// ---------------------------------------------------------------------------
// Descriptor types
// ---------------------------------------------------------------------------

export interface ContainerNodeDescriptor {
  kind: NodeKind.Container;
  /** 'global' | 'plugins' | 'project' | 'working-directory' | 'projects' */
  containerKind: 'global' | 'plugins' | 'project' | 'working-directory' | 'projects';
  label: string;
  /**
   * For global: flat leaves (ClaudeMd/Config), then type groups (Skills/Subagents/Commands/Memory),
   * then optionally a nested plugins ContainerNodeDescriptor as the last child.
   * For plugins: PluginFolderNodeDescriptor children.
   * For project: type groups + optional WorktreesFolder.
   */
  children: (ContainerNodeDescriptor | PluginFolderNodeDescriptor | AssetNodeDescriptor | GroupNodeDescriptor | WorktreesFolderNodeDescriptor)[];
}

export interface WorktreesFolderNodeDescriptor {
  kind: NodeKind.WorktreesFolder;
  label: 'Worktrees';
  children: WorktreeNameFolderNodeDescriptor[];
}

export interface WorktreeNameFolderNodeDescriptor {
  kind: NodeKind.WorktreeNameFolder;
  /** The worktree name, e.g. 'agent-ac745f103f192bf4f' */
  label: string;
  children: (GroupNodeDescriptor | AssetNodeDescriptor)[];
}

export interface PluginFolderNodeDescriptor {
  kind: NodeKind.PluginFolder;
  pluginName: string;
  label: string;
  children: GroupNodeDescriptor[];
  /** Installed version display string (present only for installed plugins) */
  description?: string;
  /** True when the plugin has a newer version available in the catalog cache */
  outdated?: boolean;
}

/**
 * Options for augmenting the Plugins tree section with installed-plugin metadata.
 * When provided, buildTreeNodes sets the version description and outdated flag on each
 * plugin folder node whose name matches an entry in the installedPlugins map.
 */
export interface PluginMetadataOptions {
  installedPlugins: Map<string, InstalledPluginInfo>;
  outdated: Set<string>;
}

export interface GroupNodeDescriptor {
  kind: NodeKind.Group;
  assetType: AssetType;
  label: string;
  children: AssetNodeDescriptor[];
}

export interface AssetNodeDescriptor {
  kind: NodeKind.Asset;
  asset: ClaudeAsset;
  label: string;
  tooltip: string;
  /** Absolute file path for resourceUri and command args */
  filePath: string;
  /** Context value for menus: "asset-md-global", "asset-config-plugin", etc. */
  contextValue: string;
  /** Command id for the default single-click action */
  commandId: string;
  /** Arguments to pass to the default command */
  commandArgs: [string];
}

export type TopLevelNode = ContainerNodeDescriptor;

// ---------------------------------------------------------------------------
// Project children builder (handles main vs. worktree split)
// ---------------------------------------------------------------------------

function buildProjectChildren(
  assets: ClaudeAsset[]
): (AssetNodeDescriptor | GroupNodeDescriptor | WorktreesFolderNodeDescriptor)[] {
  const mainAssets: ClaudeAsset[] = [];
  const worktreeMap = new Map<string, ClaudeAsset[]>();

  for (const asset of assets) {
    const info = deriveProjectInfo(asset);
    if (info.worktree === null) {
      mainAssets.push(asset);
    } else {
      const bucket = worktreeMap.get(info.worktree);
      if (bucket) {
        bucket.push(asset);
      } else {
        worktreeMap.set(info.worktree, [asset]);
      }
    }
  }

  const children: (AssetNodeDescriptor | GroupNodeDescriptor | WorktreesFolderNodeDescriptor)[] = [];

  // Main type groups (and flat leaves) first
  children.push(...buildTypeGroups(mainAssets));

  // Worktrees folder last (only when any worktree assets exist)
  if (worktreeMap.size > 0) {
    const sortedWorktreeNames = [...worktreeMap.keys()].sort((a, b) => a.localeCompare(b));
    const worktreeNameFolders: WorktreeNameFolderNodeDescriptor[] = sortedWorktreeNames.map(name => ({
      kind: NodeKind.WorktreeNameFolder as NodeKind.WorktreeNameFolder,
      label: name,
      children: buildTypeGroups(worktreeMap.get(name)!)
    }));
    children.push({
      kind: NodeKind.WorktreesFolder as NodeKind.WorktreesFolder,
      label: 'Worktrees',
      children: worktreeNameFolders
    });
  }

  return children;
}

/** Display labels for grouped asset types */
const TYPE_LABELS: Partial<Record<AssetType, string>> = {
  [AssetType.Skill]: 'Skills',
  [AssetType.Subagent]: 'Subagents',
  [AssetType.Command]: 'Commands',
  [AssetType.Memory]: 'Memory'
};

// ---------------------------------------------------------------------------
// Asset node helpers
// ---------------------------------------------------------------------------

/**
 * Determine the context value for an asset node.
 * Format: "asset-<format>-<scope>"
 * format = "md" for markdown files, "config" for JSON config
 */
function buildContextValue(asset: ClaudeAsset): string {
  const isConfig = asset.type === AssetType.Config;
  const format = isConfig ? 'config' : 'md';
  return `asset-${format}-${asset.scope}`;
}

function buildAssetNode(asset: ClaudeAsset): AssetNodeDescriptor {
  const isConfig = asset.type === AssetType.Config;
  const commandId = isConfig ? 'claudeAssets.openFile' : 'claudeAssets.openPreview';
  return {
    kind: NodeKind.Asset,
    asset,
    label: asset.name,
    tooltip: asset.filePath,
    filePath: asset.filePath,
    contextValue: buildContextValue(asset),
    commandId,
    commandArgs: [asset.filePath]
  };
}

// ---------------------------------------------------------------------------
// Type-group builder
// ---------------------------------------------------------------------------

/**
 * Canonical order for grouped type folders.
 * ClaudeMd and Config are omitted -- they are emitted as direct flat leaves, not Groups.
 */
const GROUPED_TYPE_ORDER: AssetType[] = [
  AssetType.Skill,
  AssetType.Subagent,
  AssetType.Command,
  AssetType.Memory
];

function buildTypeGroups(assets: ClaudeAsset[]): (AssetNodeDescriptor | GroupNodeDescriptor)[] {
  const byType = new Map<AssetType, ClaudeAsset[]>();
  for (const asset of assets) {
    const bucket = byType.get(asset.type);
    if (bucket) {
      bucket.push(asset);
    } else {
      byType.set(asset.type, [asset]);
    }
  }

  const result: (AssetNodeDescriptor | GroupNodeDescriptor)[] = [];

  // 1. Flat leaves: ClaudeMd (sorted alpha), then Config (sorted alpha)
  const flatOrder: AssetType[] = [AssetType.ClaudeMd, AssetType.Config];
  for (const type of flatOrder) {
    const typeAssets = byType.get(type);
    if (!typeAssets || typeAssets.length === 0) continue;
    const sorted = [...typeAssets].sort((a, b) => a.name.localeCompare(b.name));
    for (const asset of sorted) {
      result.push(buildAssetNode(asset));
    }
  }

  // 2. Grouped types: Skill, Subagent, Command, Memory
  for (const type of GROUPED_TYPE_ORDER) {
    const typeAssets = byType.get(type);
    if (!typeAssets || typeAssets.length === 0) continue;
    const sorted = [...typeAssets].sort((a, b) => a.name.localeCompare(b.name));
    result.push({
      kind: NodeKind.Group,
      assetType: type,
      label: TYPE_LABELS[type]!,
      children: sorted.map(buildAssetNode)
    });
  }

  return result;
}

/**
 * Build a "Projects" folder for memory assets, grouped by originating project.
 * Each memory asset lives at ~/.claude/projects/<encoded>/memory/...; we group by the
 * readable project name and render the memory files as direct leaves under that folder.
 * Returns undefined when there are no memory assets.
 */
function buildMemoryProjectsFolder(memoryAssets: ClaudeAsset[]): ContainerNodeDescriptor | undefined {
  if (memoryAssets.length === 0) {
    return undefined;
  }

  const byProject = new Map<string, ClaudeAsset[]>();
  for (const asset of memoryAssets) {
    const proj = deriveMemoryProject(asset.filePath);
    const group = byProject.get(proj);
    if (group) {
      group.push(asset);
    } else {
      byProject.set(proj, [asset]);
    }
  }

  const projectFolders: ContainerNodeDescriptor[] = [...byProject.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map(proj => {
      const pAssets = byProject.get(proj)!.slice().sort((a, b) => a.name.localeCompare(b.name));
      return {
        kind: NodeKind.Container as NodeKind.Container,
        containerKind: 'project' as const,
        label: proj,
        children: pAssets.map(buildAssetNode)
      };
    });

  return {
    kind: NodeKind.Container,
    containerKind: 'projects',
    label: 'Projects',
    children: projectFolders
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Pure function: given a list of assets, return the container-based tree node
 * descriptors. No vscode import here -- callers map these to TreeItems.
 *
 * Top-level order:
 *   1. Global (if any global-scoped OR plugin-scoped assets exist).
 *      Global children: flat leaves (ClaudeMd, then Config sorted alpha), then type groups
 *      (Skills, Subagents, Commands), then a "Projects" folder holding per-project memory,
 *      then optionally a Plugins folder as the LAST child (only when plugin assets exist).
 *   2. Working Directory container holding project containers, sorted alpha (when any exist)
 *
 * When pluginMeta is provided, each PluginFolder node gets a version description and,
 * when in the outdated set, the "update available" text + outdated flag.
 * When pluginMeta is omitted, the flat folder list is returned with no descriptions.
 */
export function buildTreeNodes(assets: ClaudeAsset[], pluginMeta?: PluginMetadataOptions): TopLevelNode[] {
  const nodes: TopLevelNode[] = [];

  // Normalize pluginMeta: treat missing, undefined, or partial object as empty maps/sets
  const installedPlugins: Map<string, InstalledPluginInfo> =
    (pluginMeta && (pluginMeta as Partial<PluginMetadataOptions>).installedPlugins) ? pluginMeta.installedPlugins : new Map();
  const outdatedPlugins: Set<string> =
    (pluginMeta && (pluginMeta as Partial<PluginMetadataOptions>).outdated) ? pluginMeta.outdated : new Set();

  // Partition by scope
  const globalAssets: ClaudeAsset[] = [];
  const pluginAssets: ClaudeAsset[] = [];
  const projectAssetsByName = new Map<string, ClaudeAsset[]>();

  for (const asset of assets) {
    if (asset.scope === AssetScope.Global) {
      globalAssets.push(asset);
    } else if (asset.scope === AssetScope.Plugin) {
      pluginAssets.push(asset);
    } else {
      // Project or Registered -- use deriveProjectInfo to key by project name
      const info = deriveProjectInfo(asset);
      const name = info.project;
      const group = projectAssetsByName.get(name);
      if (group) {
        group.push(asset);
      } else {
        projectAssetsByName.set(name, [asset]);
      }
    }
  }

  // Build Plugins folder node (nested inside Global) when any plugin assets exist
  let pluginsFolderNode: ContainerNodeDescriptor | undefined;
  if (pluginAssets.length > 0) {
    // Group plugin assets by plugin name
    const byPlugin = new Map<string, ClaudeAsset[]>();
    for (const asset of pluginAssets) {
      const pluginName = derivePluginName(asset.filePath);
      const group = byPlugin.get(pluginName);
      if (group) {
        group.push(asset);
      } else {
        byPlugin.set(pluginName, [asset]);
      }
    }

    const sortedPluginNames = [...byPlugin.keys()].sort((a, b) => a.localeCompare(b));

    const pluginFolders: PluginFolderNodeDescriptor[] = sortedPluginNames.map(pluginName => {
      const pAssets = byPlugin.get(pluginName)!;

      // Plugin assets never include ClaudeMd or Config, so buildTypeGroups returns only GroupNodeDescriptors
      const pluginGroups = buildTypeGroups(pAssets) as GroupNodeDescriptor[];

      const info = installedPlugins.get(pluginName);
      if (info) {
        const isOut = outdatedPlugins.has(pluginName);
        const descStr = isOut ? `${info.version} - update available` : info.version;
        return {
          kind: NodeKind.PluginFolder as NodeKind.PluginFolder,
          pluginName,
          label: pluginName,
          children: pluginGroups,
          description: descStr,
          outdated: isOut || undefined
        };
      }

      // Plugin not in installed map: no description
      return {
        kind: NodeKind.PluginFolder as NodeKind.PluginFolder,
        pluginName,
        label: pluginName,
        children: pluginGroups
      };
    });

    pluginsFolderNode = {
      kind: NodeKind.Container,
      containerKind: 'plugins',
      label: 'Plugins',
      children: pluginFolders
    };
  }

  // 1. Global container -- appears when global assets OR plugin assets exist.
  //    Memory assets (~/.claude/projects/<project>/memory) are grouped under a nested
  //    "Projects" folder; the Plugins folder is appended last.
  if (globalAssets.length > 0 || pluginsFolderNode !== undefined) {
    const memoryAssets = globalAssets.filter(a => a.type === AssetType.Memory);
    const nonMemoryGlobal = globalAssets.filter(a => a.type !== AssetType.Memory);

    const globalChildren: ContainerNodeDescriptor['children'] = [
      ...buildTypeGroups(nonMemoryGlobal)
    ];

    const projectsFolderNode = buildMemoryProjectsFolder(memoryAssets);
    if (projectsFolderNode !== undefined) {
      globalChildren.push(projectsFolderNode);
    }
    if (pluginsFolderNode !== undefined) {
      globalChildren.push(pluginsFolderNode);
    }
    nodes.push({
      kind: NodeKind.Container,
      containerKind: 'global',
      label: 'Global',
      children: globalChildren
    });
  }

  // 2. Working Directory container holding one sub-container per project.
  const sortedProjects = [...projectAssetsByName.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (sortedProjects.length > 0) {
    const projectContainers: ContainerNodeDescriptor[] = sortedProjects.map(
      ([projectName, projAssets]) => ({
        kind: NodeKind.Container,
        containerKind: 'project',
        label: projectName,
        children: buildProjectChildren(projAssets)
      })
    );

    nodes.push({
      kind: NodeKind.Container,
      containerKind: 'working-directory',
      label: 'Working Directory',
      children: projectContainers
    });
  }

  return nodes;
}
