import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset } from '../core/types';
import { InstalledPluginInfo, MarketplaceInfo } from '../core/pluginMetadata';
import { derivePluginName, deriveProjectInfo, deriveMemoryProject, isRootLevelAsset } from '../core/containerDerivations';

export enum NodeKind {
  Container = 'Container',
  PluginFolder = 'PluginFolder',
  Group = 'Group',
  Asset = 'Asset',
  WorktreesFolder = 'WorktreesFolder',
  WorktreeNameFolder = 'WorktreeNameFolder',
  FsDir = 'FsDir',
  FsFile = 'FsFile'
}

// ---------------------------------------------------------------------------
// Descriptor types
// ---------------------------------------------------------------------------

export interface ContainerNodeDescriptor {
  kind: NodeKind.Container;
  /** 'global' | 'plugins' | 'marketplace' | 'project' | 'working-directory' | 'projects' */
  containerKind: 'global' | 'plugins' | 'marketplace' | 'project' | 'working-directory' | 'projects';
  label: string;
  /**
   * For global: flat leaves (ClaudeMd/Config), then type groups (Skills/Subagents/Commands/Memory),
   * then optionally a nested plugins ContainerNodeDescriptor as the last child.
   * For plugins: PluginFolderNodeDescriptor children.
   * For project: type groups + optional WorktreesFolder.
   */
  children: (ContainerNodeDescriptor | PluginFolderNodeDescriptor | AssetNodeDescriptor | GroupNodeDescriptor | WorktreesFolderNodeDescriptor)[];
  /** Optional right-aligned text (e.g. the Plugins folder's "N Updates available" summary) */
  description?: string;
  /** Optional override for the TreeItem contextValue, used to gate context-menu commands */
  contextValue?: string;
  /** Backing real directory, when this container maps to one (plugins/, projects/) -- enables Reveal. */
  dirPath?: string;
}

export interface WorktreesFolderNodeDescriptor {
  kind: NodeKind.WorktreesFolder;
  label: 'worktrees';
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
  /** Full "name@marketplace" identifier passed to `claude plugin update` (present only for installed plugins) */
  pluginId?: string;
  label: string;
  children: GroupNodeDescriptor[];
  /** When set, the folder renders this install directory's files lazily (metadata-driven view). */
  dirPath?: string;
  /** Installed version display string (present only for installed plugins) */
  description?: string;
  /** True when the plugin has a newer version available in the catalog cache */
  outdated?: boolean;
  /** Enabled state; undefined when unknown (no enabled map was provided). */
  enabled?: boolean;
}

/**
 * Options for augmenting the Plugins tree section with installed-plugin metadata.
 * When provided, buildTreeNodes sets the version description and outdated flag on each
 * plugin folder node whose name matches an entry in the installedPlugins map.
 */
export interface PluginMetadataOptions {
  installedPlugins: Map<string, InstalledPluginInfo>;
  outdated: Set<string>;
  /** Plugin id -> enabled boolean from settings.json enabledPlugins. When omitted, enabled state is unknown. */
  enabled?: Map<string, boolean>;
  /** name -> info, from known_marketplaces.json. When provided, empty marketplaces also show in the tree. */
  marketplaces?: Map<string, MarketplaceInfo>;
}

export interface GroupNodeDescriptor {
  kind: NodeKind.Group;
  assetType: AssetType;
  label: string;
  children: AssetNodeDescriptor[];
  /**
   * When set, the group mirrors this real directory's full contents lazily
   * (every file and subdirectory), instead of using `children`. Used for
   * Skills (the skills/ root) and Agents (the agents/ root).
   */
  dirPath?: string;
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
      label: 'worktrees',
      children: worktreeNameFolders
    });
  }

  return children;
}

/** Display labels for grouped asset types */
// Labels match the on-disk directory names (skills/, agents/, commands/, memory/).
const TYPE_LABELS: Partial<Record<AssetType, string>> = {
  [AssetType.Skill]: 'skills',
  [AssetType.Subagent]: 'agents',
  [AssetType.Command]: 'commands',
  [AssetType.Memory]: 'memory'
};

/**
 * Given an asset file path and a directory-segment name ("skills" or "agents"),
 * return the absolute path of that segment directory (e.g. ".../skills"), or
 * undefined when the segment is not present in the path. Uses the deepest match.
 */
function deriveSegmentRoot(filePath: string, segment: string): string | undefined {
  const norm = filePath.replace(/\\/g, '/');
  const marker = `/${segment}/`;
  const idx = norm.lastIndexOf(marker);
  if (idx === -1) return undefined;
  // Keep through the segment name itself; slice off the trailing slash.
  return filePath.slice(0, idx + marker.length - 1);
}

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
  // Open with the user's default editor for the file type; config (JSON) opens as a file.
  const commandId = isConfig ? 'claudeAssets.openFile' : 'claudeAssets.openMarkdown';
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

    // Skills and Agents mirror their backing directory (skills/ or agents/) so
    // every file and subdirectory shows, not just the recognized asset files.
    if (type === AssetType.Skill || type === AssetType.Subagent) {
      const segment = type === AssetType.Skill ? 'skills' : 'agents';
      const dirPath = deriveSegmentRoot(sorted[0].filePath, segment);
      if (dirPath) {
        result.push({
          kind: NodeKind.Group,
          assetType: type,
          label: TYPE_LABELS[type]!,
          children: [],
          dirPath
        });
        continue;
      }
    }

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
    label: 'projects',
    children: projectFolders,
    contextValue: 'assetProjectsRoot',
    dirPath: deriveSegmentRoot(memoryAssets[0].filePath, 'projects')
  };
}

// ---------------------------------------------------------------------------
// Enabled-count summary helpers
// ---------------------------------------------------------------------------

/** Returns "X/Y plugins enabled" for a set of installed plugins, or undefined when state unknown or no plugins. */
function enabledSummary(infos: InstalledPluginInfo[], enabledMap?: Map<string, boolean>): string | undefined {
  if (!enabledMap || infos.length === 0) return undefined;
  const enabled = infos.filter(i => enabledMap.get(i.id) !== false).length;
  return `${enabled}/${infos.length} plugins enabled`;
}

/** Joins non-empty parts with " · "; returns undefined when all parts are empty. */
function joinDesc(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept.join(' · ') : undefined;
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
  const enabledMap: Map<string, boolean> | undefined =
    (pluginMeta && (pluginMeta as Partial<PluginMetadataOptions>).enabled) ? pluginMeta.enabled : undefined;
  const knownMarketplaces: Map<string, MarketplaceInfo> | undefined =
    (pluginMeta && (pluginMeta as Partial<PluginMetadataOptions>).marketplaces) ? pluginMeta.marketplaces : undefined;

  // Partition by scope
  const globalAssets: ClaudeAsset[] = [];
  const pluginAssets: ClaudeAsset[] = [];
  const workingRootAssets: ClaudeAsset[] = [];
  const projectAssetsByName = new Map<string, ClaudeAsset[]>();

  for (const asset of assets) {
    if (asset.scope === AssetScope.Global) {
      globalAssets.push(asset);
    } else if (asset.scope === AssetScope.Plugin) {
      pluginAssets.push(asset);
    } else if (isRootLevelAsset(asset)) {
      // Belongs to the working-directory root itself -- render flat at the WD root,
      // not inside a folder named after the root.
      workingRootAssets.push(asset);
    } else {
      // A sub-project beneath the root -- key by derived project name
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

  // Build the Plugins folder (nested inside Global).
  //
  // With plugin metadata we drive the list from installed_plugins.json: every
  // installed plugin shows (even asset-less ones like LSP plugins), uninstalled
  // leftovers on disk are hidden, plugins are nested under their source marketplace
  // folder (mirroring plugins/cache/<marketplace>/<plugin>), and each plugin folder
  // renders its install directory's files lazily.
  //
  // Without metadata (unit tests) we fall back to the asset-derived view: a flat list
  // of plugin folders whose children are the scanned assets grouped by type.
  let pluginsFolderNode: ContainerNodeDescriptor | undefined;

  if (installedPlugins.size > 0 || (knownMarketplaces && knownMarketplaces.size > 0)) {
    const updatableCount = [...installedPlugins.keys()].filter(n => outdatedPlugins.has(n)).length;

    const buildPluginFolder = (info: InstalledPluginInfo): PluginFolderNodeDescriptor => {
      const isOut = outdatedPlugins.has(info.name);
      const enabled = enabledMap ? (enabledMap.get(info.id) !== false) : undefined;
      // A version of "unknown" is the literal placeholder the plugin installer
      // records when a plugin.json declares no version; render nothing rather
      // than the noisy word.
      let descStr = info.version && info.version !== 'unknown' ? info.version : '';
      if (isOut) descStr += descStr ? ' - update available ↓' : 'update available ↓';
      if (enabled === false) descStr += descStr ? ' (disabled)' : '(disabled)';
      return {
        kind: NodeKind.PluginFolder as NodeKind.PluginFolder,
        pluginName: info.name,
        pluginId: info.id,
        label: info.name,
        children: [],
        description: descStr,
        outdated: isOut || undefined,
        enabled,
        dirPath: info.installPath || undefined
      };
    };

    // Group installed plugins by their source marketplace.
    const byMarketplace = new Map<string, InstalledPluginInfo[]>();
    for (const info of installedPlugins.values()) {
      const mk = info.marketplace || '(local)';
      const group = byMarketplace.get(mk);
      if (group) {
        group.push(info);
      } else {
        byMarketplace.set(mk, [info]);
      }
    }

    // Build the union of installed-derived names and known marketplace names.
    const allNames = new Set<string>([...byMarketplace.keys()]);
    if (knownMarketplaces) {
      for (const n of knownMarketplaces.keys()) allNames.add(n);
    }

    const marketplaceFolders: ContainerNodeDescriptor[] = [...allNames]
      .sort((a, b) => a.localeCompare(b))
      .map(mk => {
        const infos = (byMarketplace.get(mk) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
        // Marketplace dir on disk is the parent of <plugin>/<version>: .../plugins/cache/<marketplace>.
        const sample = infos.find(i => i.installPath);
        const mkDir = sample
          ? path.dirname(path.dirname(sample.installPath))
          : (knownMarketplaces?.get(mk)?.installLocation || undefined);
        const mkOutdated = infos.filter(i => outdatedPlugins.has(i.name)).length;
        const updatesText = mkOutdated > 0
          ? `${mkOutdated} update${mkOutdated === 1 ? '' : 's'} available ↓`
          : undefined;
        const mkDescription = infos.length === 0
          ? '(no plugins installed)'
          : joinDesc([enabledSummary(infos, enabledMap), updatesText]);
        return {
          kind: NodeKind.Container as NodeKind.Container,
          containerKind: 'marketplace' as const,
          label: mk,
          children: infos.map(buildPluginFolder),
          description: mkDescription,
          // Outdated variant gates the marketplace-level "Update Plugins" command.
          contextValue: mkOutdated > 0 ? 'assetMarketplaceOutdated' : 'assetMarketplace',
          dirPath: mkDir
        };
      });

    // Plugins root for Reveal (.../plugins), derived from any install path.
    const anyInstall = [...installedPlugins.values()].find(i => i.installPath);
    const pluginsRoot = anyInstall
      ? deriveSegmentRoot(anyInstall.installPath, 'plugins')
      : (pluginAssets.length > 0 ? deriveSegmentRoot(pluginAssets[0].filePath, 'plugins') : undefined);

    const allInstalled = [...installedPlugins.values()];
    const rootUpdates = updatableCount > 0
      ? `${updatableCount} update${updatableCount === 1 ? '' : 's'} available ↓`
      : undefined;
    pluginsFolderNode = {
      kind: NodeKind.Container,
      containerKind: 'plugins',
      label: 'plugins',
      children: marketplaceFolders,
      description: joinDesc([enabledSummary(allInstalled, enabledMap), rootUpdates]),
      // Outdated variant gates the "Update All" command; both variants are reveal-able.
      contextValue: updatableCount > 0 ? 'assetPluginsRootOutdated' : 'assetPluginsRoot',
      dirPath: pluginsRoot
    };
  } else if (pluginAssets.length > 0) {
    // Asset-derived fallback (no metadata): flat plugin folders with type-group children.
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
    const pluginFolders: PluginFolderNodeDescriptor[] = sortedPluginNames.map(pluginName => ({
      kind: NodeKind.PluginFolder as NodeKind.PluginFolder,
      pluginName,
      label: pluginName,
      children: buildTypeGroups(byPlugin.get(pluginName)!) as GroupNodeDescriptor[]
    }));
    pluginsFolderNode = {
      kind: NodeKind.Container,
      containerKind: 'plugins',
      label: 'plugins',
      children: pluginFolders,
      contextValue: 'assetPluginsRoot',
      dirPath: deriveSegmentRoot(pluginAssets[0].filePath, 'plugins')
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

  // 2. Working Directory container: the root's own assets rendered flat at the top,
  //    then one sub-container per sub-project (sorted alpha).
  const sortedProjects = [...projectAssetsByName.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (sortedProjects.length > 0 || workingRootAssets.length > 0) {
    const wdChildren: ContainerNodeDescriptor['children'] = [];

    // Root-level assets (e.g. the working dir's own .claude/settings.local.json) flat first
    if (workingRootAssets.length > 0) {
      wdChildren.push(...buildProjectChildren(workingRootAssets));
    }

    // Sub-projects as folders
    for (const [projectName, projAssets] of sortedProjects) {
      wdChildren.push({
        kind: NodeKind.Container,
        containerKind: 'project',
        label: projectName,
        children: buildProjectChildren(projAssets)
      });
    }

    nodes.push({
      kind: NodeKind.Container,
      containerKind: 'working-directory',
      label: 'Working Directory',
      children: wdChildren
    });
  }

  return nodes;
}
