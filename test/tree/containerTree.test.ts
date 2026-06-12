import * as assert from 'assert';
import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset } from '../../src/core/types';
import {
  buildTreeNodes,
  NodeKind,
  ContainerNodeDescriptor,
  PluginFolderNodeDescriptor,
  GroupNodeDescriptor,
  AssetNodeDescriptor,
  WorktreesFolderNodeDescriptor,
  WorktreeNameFolderNodeDescriptor,
  PluginMetadataOptions
} from '../../src/tree/nodeDescriptors';
import { InstalledPluginInfo, MarketplaceInfo } from '../../src/core/pluginMetadata';

function makeAsset(
  type: AssetType,
  name: string,
  filePath: string,
  scope: AssetScope,
  rootPath: string,
  description?: string
): ClaudeAsset {
  return { type, name, filePath, scope, description, rootPath };
}

// Project containers now live inside the top-level "Working Directory" container.
function getWorkingDir(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor | undefined {
  return (nodes as ContainerNodeDescriptor[]).find(
    n => n.kind === NodeKind.Container && n.containerKind === 'working-directory'
  );
}

function getProjects(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor[] {
  const wd = getWorkingDir(nodes);
  return wd ? (wd.children as ContainerNodeDescriptor[]).filter(c => c.containerKind === 'project') : [];
}

function findProject(nodes: ReturnType<typeof buildTreeNodes>, label: string): ContainerNodeDescriptor | undefined {
  return getProjects(nodes).find(c => c.label === label);
}

function getAddedDirs(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor | undefined {
  return (nodes as ContainerNodeDescriptor[]).find(
    n => n.kind === NodeKind.Container && n.containerKind === 'added-directories'
  );
}

function findAddedProject(nodes: ReturnType<typeof buildTreeNodes>, label: string): ContainerNodeDescriptor | undefined {
  const added = getAddedDirs(nodes);
  return added ? (added.children as ContainerNodeDescriptor[]).find(c => c.label === label) : undefined;
}

// ---------------------------------------------------------------------------
// Container-level structure
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- container-based top-level structure', () => {
  it('Global container appears first when global assets exist', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'global-skill', '/home/user/.claude/skills/global-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    assert.ok(nodes.length >= 1, 'expected at least one node');
    assert.strictEqual(nodes[0].kind, NodeKind.Container, 'first node should be Container');
    const first = nodes[0] as ContainerNodeDescriptor;
    assert.strictEqual(first.containerKind, 'global', 'first container should be global');
  });

  it('Plugins folder appears as last child of Global (not at top level) when plugin assets exist', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    // Top level must be only Global (no top-level Plugins container)
    assert.strictEqual(nodes.length, 1, 'expected exactly 1 top-level node (Global only, no top-level Plugins)');
    const global = nodes[0] as ContainerNodeDescriptor;
    assert.strictEqual(global.containerKind, 'global');
    // Plugins folder is the last child of Global
    const lastChild = global.children[global.children.length - 1];
    assert.strictEqual(lastChild.kind, NodeKind.Container, 'last child of Global should be the Plugins container');
    assert.strictEqual((lastChild as ContainerNodeDescriptor).containerKind, 'plugins', 'last child of Global should have containerKind plugins');
  });

  it('Projects are nested under the Working Directory container, sorted alphabetically', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'z-skill', '/Users/braden/Projects/Zebra/.claude/skills/z-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'a-skill', '/Users/braden/Projects/Alpha/.claude/skills/a-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    // No project containers at top level
    const topLevelProjects = (nodes as ContainerNodeDescriptor[]).filter(n => n.kind === NodeKind.Container && n.containerKind === 'project');
    assert.strictEqual(topLevelProjects.length, 0, 'projects must not be at top level');
    // Global comes first
    assert.strictEqual((nodes[0] as ContainerNodeDescriptor).containerKind, 'global');
    // Working Directory holds the projects, sorted alpha
    const projects = getProjects(nodes);
    assert.strictEqual(projects.length, 2, 'expected 2 project containers under Working Directory');
    assert.strictEqual(projects[0].label, 'Alpha');
    assert.strictEqual(projects[1].label, 'Zebra');
  });

  it('Omits Plugins folder when no plugin assets exist', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    // No top-level plugins container
    const topLevelPlugins = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'plugins');
    assert.strictEqual(topLevelPlugins, undefined, 'No top-level Plugins container should ever exist');
    // No plugins folder inside Global either
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const pluginsChild = global.children.find(c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins');
    assert.strictEqual(pluginsChild, undefined, 'Plugins folder should not appear inside Global when no plugins');
  });

  it('Omits Global container when no global assets exist', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'p-skill', '/Users/braden/Projects/MyApp/.claude/skills/p-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const globalNode = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
    assert.strictEqual(globalNode, undefined, 'Global container should not appear when no global assets');
  });
});

// ---------------------------------------------------------------------------
// Global container children (type groups)
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- Global container children', () => {
  it('Global container children: Config is a direct leaf (no Group), Skill is a group, leaf before group', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const globalContainer = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(globalContainer, 'expected Global container');
    assert.strictEqual(globalContainer.children.length, 2, 'expected 2 children: Config leaf + Skills group');
    // Config is now a direct leaf (NodeKind.Asset), comes first
    const firstChild = globalContainer.children[0] as AssetNodeDescriptor;
    assert.strictEqual(firstChild.kind, NodeKind.Asset, 'Config should be a direct Asset leaf');
    assert.strictEqual(firstChild.asset.type, AssetType.Config, 'first child should be Config leaf');
    // Skills is a Group, comes after
    const secondChild = globalContainer.children[1] as GroupNodeDescriptor;
    assert.strictEqual(secondChild.kind, NodeKind.Group, 'Skills should be in a Group');
    assert.strictEqual(secondChild.assetType, AssetType.Skill, 'second child group should be Skills');
  });

  it('Skills group mirrors the skills/ directory (dirPath set, children listed lazily)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'zebra-skill', '/home/user/.claude/skills/zebra-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'alpha-skill', '/home/user/.claude/skills/alpha-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const globalContainer = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const skillGroup = globalContainer.children.find(c => (c as GroupNodeDescriptor).assetType === AssetType.Skill) as GroupNodeDescriptor;
    assert.strictEqual(skillGroup.dirPath, '/home/user/.claude/skills', 'Skills group should point at the skills/ root');
    assert.strictEqual(skillGroup.children.length, 0, 'skill children are listed lazily from disk');
  });
});

// ---------------------------------------------------------------------------
// Plugins container children
// ---------------------------------------------------------------------------

// Helper to get Plugins container from inside Global (used by early tests before getPluginsContainer helper is declared)
function getPluginsFromGlobal(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor | undefined {
  const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
  if (!global) return undefined;
  return global.children.find(c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins') as ContainerNodeDescriptor | undefined;
}

describe('buildTreeNodes -- Plugins folder children (nested inside Global)', () => {
  it('Plugins folder children are plugin-folder nodes sorted alpha', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/plugin-z/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins'),
      makeAsset(AssetType.Skill, 'q-skill', '/home/user/.claude/plugins/cache/mk/plugin-a/1.0/skills/q-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const pluginsContainer = getPluginsFromGlobal(nodes)!;
    assert.ok(pluginsContainer, 'expected Plugins folder inside Global');
    assert.strictEqual(pluginsContainer.children.length, 2);
    // plugin-a comes before plugin-z
    assert.strictEqual((pluginsContainer.children[0] as PluginFolderNodeDescriptor).label, 'plugin-a');
    assert.strictEqual((pluginsContainer.children[1] as PluginFolderNodeDescriptor).label, 'plugin-z');
  });

  it('Plugin-folder children are type-group nodes', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins'),
      makeAsset(AssetType.Subagent, 'p-agent', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/agents/p-agent.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const pluginsContainer = getPluginsFromGlobal(nodes)!;
    const pluginFolder = pluginsContainer.children[0] as PluginFolderNodeDescriptor;
    assert.strictEqual(pluginFolder.kind, NodeKind.PluginFolder);
    assert.strictEqual(pluginFolder.pluginName, 'myplugin');
    // type groups inside
    const groupKinds = pluginFolder.children.map(c => (c as GroupNodeDescriptor).assetType);
    assert.ok(groupKinds.includes(AssetType.Skill), 'should have Skill group');
    assert.ok(groupKinds.includes(AssetType.Subagent), 'should have Subagent group');
    // canonical order: Skill before Subagent
    const skillIdx = groupKinds.indexOf(AssetType.Skill);
    const agentIdx = groupKinds.indexOf(AssetType.Subagent);
    assert.ok(skillIdx < agentIdx, 'Skills group should come before Subagents in canonical order');
  });

  it('Plugin-folder type-group asset nodes have asset-md contextValue and openPreview command', () => {
    const filePath = '/home/user/.claude/plugins/cache/mk/myplugin/1.0/commands/p-cmd.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'p-cmd', filePath, AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const pluginsContainer = getPluginsFromGlobal(nodes)!;
    const pluginFolder = pluginsContainer.children[0] as PluginFolderNodeDescriptor;
    const cmdGroup = pluginFolder.children[0] as GroupNodeDescriptor;
    const assetNode = cmdGroup.children[0] as AssetNodeDescriptor;
    assert.strictEqual(assetNode.kind, NodeKind.Asset);
    assert.ok(assetNode.contextValue.includes('-md-'), 'plugin asset should have -md- contextValue');
    assert.strictEqual(assetNode.commandId, 'claudeAssets.openMarkdown');
  });

  it('uses real plugin path shapes: cache path -> correct plugin name', () => {
    const filePath = '/Users/braden/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/SKILL.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'claude-automation-recommender', filePath, AssetScope.Plugin, '/Users/braden/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const pluginsContainer = getPluginsFromGlobal(nodes)!;
    const pluginFolder = pluginsContainer.children[0] as PluginFolderNodeDescriptor;
    assert.strictEqual(pluginFolder.pluginName, 'claude-code-setup');
  });

  it('uses real plugin path shapes: marketplaces path -> correct plugin name', () => {
    const filePath = '/Users/braden/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'frontend-design', filePath, AssetScope.Plugin, '/Users/braden/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const pluginsContainer = getPluginsFromGlobal(nodes)!;
    const pluginFolder = pluginsContainer.children[0] as PluginFolderNodeDescriptor;
    assert.strictEqual(pluginFolder.pluginName, 'frontend-design');
  });
});

// ---------------------------------------------------------------------------
// Project containers
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- project containers', () => {
  it('project folder children are type-group nodes, type groups only for present types', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Subagent, 'proj-agent', '/Users/braden/Projects/MyApp/.claude/agents/proj-agent.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const projContainer = findProject(nodes, 'MyApp')!;
    assert.ok(projContainer, 'expected MyApp project container');
    const typeGroups = projContainer.children as GroupNodeDescriptor[];
    const types = typeGroups.map(g => g.assetType);
    assert.ok(types.includes(AssetType.Skill), 'should have Skill group');
    assert.ok(types.includes(AssetType.Subagent), 'should have Subagent group');
    assert.ok(!types.includes(AssetType.Command), 'Command group should be absent');
    // canonical order
    assert.ok(types.indexOf(AssetType.Skill) < types.indexOf(AssetType.Subagent));
  });

  it('project asset nodes preserve contextValue and command', () => {
    const filePath = '/Users/braden/Projects/MyApp/.claude/commands/proj-cmd.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'proj-cmd', filePath, AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const projContainer = getProjects(nodes)[0];
    const cmdGroup = projContainer.children[0] as GroupNodeDescriptor;
    const assetNode = cmdGroup.children[0] as AssetNodeDescriptor;
    assert.ok(assetNode.contextValue.includes('-md-'), 'command asset should have -md- contextValue');
    assert.strictEqual(assetNode.commandId, 'claudeAssets.openMarkdown');
    assert.strictEqual(assetNode.filePath, filePath);
  });

  it('config asset in project is a direct leaf with openFile command (no Group wrapper)', () => {
    const filePath = '/Users/braden/Projects/MyApp/.claude/settings.json';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Config, 'settings.json', filePath, AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const projContainer = getProjects(nodes)[0];
    // Config is now a direct AssetNodeDescriptor leaf, not wrapped in a Group
    const assetNode = projContainer.children[0] as AssetNodeDescriptor;
    assert.strictEqual(assetNode.kind, NodeKind.Asset, 'Config should be a direct Asset leaf in project container');
    assert.strictEqual(assetNode.commandId, 'claudeAssets.openFile');
    assert.ok(assetNode.contextValue.includes('asset-config'), 'config should have asset-config contextValue');
  });

  it('multiple projects each get their own container', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'a-skill', '/Users/braden/Projects/Alpha/.claude/skills/a-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'b-skill', '/Users/braden/Projects/Beta/.claude/skills/b-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const projects = getProjects(nodes);
    assert.strictEqual(projects.length, 2);
    const labels = projects.map(c => c.label);
    assert.deepStrictEqual(labels, ['Alpha', 'Beta'], 'projects should be sorted alphabetically');
  });

  it('Registered-scope assets grouped by derived project name under Added Directories', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'reg-skill', '/Users/braden/Projects/foo/skills/bar/SKILL.md', AssetScope.Registered, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    // Registered (user-added) dirs live in their own Added Directories section, not Working Directory.
    assert.ok(!getWorkingDir(nodes), 'registered-only assets should not create a Working Directory container');
    const projContainer = findAddedProject(nodes, 'foo');
    assert.ok(projContainer, 'registered asset should be grouped under project "foo" in Added Directories');
  });

  it('shows a folder for every registered dir (from meta), even ones with no Claude assets', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'r-skill', '/Users/braden/HasAssets/.claude/skills/r-skill/SKILL.md', AssetScope.Registered, '/Users/braden/HasAssets')
    ];
    const meta = { registeredDirs: ['/Users/braden/HasAssets', '/Users/braden/Empty'] } as unknown as PluginMetadataOptions;
    const nodes = buildTreeNodes(assets, meta);
    const withAssets = findAddedProject(nodes, 'HasAssets');
    const empty = findAddedProject(nodes, 'Empty');
    assert.ok(withAssets, 'registered dir with assets should show');
    assert.ok(empty, 'registered dir with NO Claude assets should still show as a folder');
    assert.strictEqual(empty!.children.length, 0, 'empty registered dir has no children');
    assert.ok(/no Claude assets/i.test(empty!.description ?? ''), 'empty dir notes it has no Claude assets');
    assert.strictEqual(empty!.contextValue, 'registeredRoot', 'registered-dir folder is removable (registeredRoot contextValue)');
    assert.strictEqual(empty!.dirPath, '/Users/braden/Empty', 'registered-dir folder carries its path for reveal/remove');
  });

  it('Project and Registered assets land in separate Working Directory and Added Directories sections', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'p-skill', '/Users/braden/Projects/MyApp/.claude/skills/p-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'r-skill', '/Users/braden/Other/lib/.claude/skills/r-skill/SKILL.md', AssetScope.Registered, '/Users/braden/Other')
    ];
    const nodes = buildTreeNodes(assets);
    assert.ok(getWorkingDir(nodes), 'Working Directory container present for the project asset');
    assert.ok(getAddedDirs(nodes), 'Added Directories container present for the registered asset');
    assert.ok(findProject(nodes, 'MyApp'), 'MyApp under Working Directory');
    assert.ok(findAddedProject(nodes, 'lib'), 'lib under Added Directories');
    // The registered project must NOT also appear under Working Directory.
    assert.ok(!findProject(nodes, 'lib'), 'registered dir should not leak into Working Directory');
  });
});

// ---------------------------------------------------------------------------
// Full container ordering: Global -> Plugins -> projects alpha
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- container ordering end-to-end', () => {
  it('full ordering: Global (with Plugins as last child), then Working Directory holding projects alpha', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins'),
      makeAsset(AssetType.Skill, 'z-skill', '/Users/braden/Projects/Zebra/.claude/skills/z-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'a-skill', '/Users/braden/Projects/Alpha/.claude/skills/a-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    // Top-level: Global, Working Directory (2 nodes -- Plugins inside Global, projects inside Working Directory)
    assert.strictEqual(nodes.length, 2, 'expected 2 top-level nodes: Global, Working Directory');
    assert.strictEqual(nodes[0].kind, NodeKind.Container);
    assert.strictEqual((nodes[0] as ContainerNodeDescriptor).containerKind, 'global');
    assert.strictEqual((nodes[1] as ContainerNodeDescriptor).containerKind, 'working-directory');
    assert.strictEqual((nodes[1] as ContainerNodeDescriptor).label, 'Working Directory');
    // Projects sorted alpha under Working Directory
    const projects = getProjects(nodes);
    assert.deepStrictEqual(projects.map(p => p.label), ['Alpha', 'Zebra']);
    // Plugins folder is the last child of Global
    const global = nodes[0] as ContainerNodeDescriptor;
    const lastGlobalChild = global.children[global.children.length - 1];
    assert.strictEqual(lastGlobalChild.kind, NodeKind.Container);
    assert.strictEqual((lastGlobalChild as ContainerNodeDescriptor).containerKind, 'plugins');
  });
});

// ---------------------------------------------------------------------------
// Plugins folder as last child of Global
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- Plugins folder is last child of Global', () => {
  it('AC-PLUG-GLOBAL-1: Plugins folder is the last child of Global, after type groups', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(global, 'expected Global container');
    // Last child must be the Plugins folder
    const lastChild = global.children[global.children.length - 1];
    assert.strictEqual(lastChild.kind, NodeKind.Container, 'last child of Global should be Container');
    assert.strictEqual((lastChild as ContainerNodeDescriptor).containerKind, 'plugins', 'last child should have containerKind plugins');
    // Skills group must appear before Plugins
    const skillGroupIdx = global.children.findIndex(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Skill);
    const pluginsIdx = global.children.length - 1;
    assert.ok(skillGroupIdx < pluginsIdx, 'Skills group should appear before Plugins folder');
  });

  it('AC-PLUG-GLOBAL-2: Plugins folder does not appear at top level', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const topLevelPlugins = (nodes as ContainerNodeDescriptor[]).find(n => n.kind === NodeKind.Container && (n as ContainerNodeDescriptor).containerKind === 'plugins');
    assert.strictEqual(topLevelPlugins, undefined, 'no top-level Plugins container should ever exist');
  });

  it('AC-PLUG-GLOBAL-3: Global appears when only plugin assets exist (to host Plugins folder)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
    assert.ok(global, 'Global container should appear when plugin assets exist (to host Plugins folder)');
    const pluginsChild = global!.children.find(c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins');
    assert.ok(pluginsChild, 'Global should have a Plugins folder child when plugin assets exist');
  });

  it('AC-PLUG-GLOBAL-4: Global children ordering: flat files, type groups, Projects (memory), then Plugins', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', '/home/user/.claude/CLAUDE.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Memory, 'mem', '/home/user/.claude/projects/-Users-x-Projects-Demo/memory/mem.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md', AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(global, 'expected Global container');

    // [0] CLAUDE.md leaf, [1] settings.json leaf, [2] Skills group, [3] Projects folder (memory), [4] Plugins folder
    assert.strictEqual(global.children[0].kind, NodeKind.Asset, '[0] should be flat leaf (CLAUDE.md)');
    assert.strictEqual((global.children[0] as AssetNodeDescriptor).asset.type, AssetType.ClaudeMd);
    assert.strictEqual(global.children[1].kind, NodeKind.Asset, '[1] should be flat leaf (Config)');
    assert.strictEqual((global.children[1] as AssetNodeDescriptor).asset.type, AssetType.Config);
    assert.strictEqual(global.children[2].kind, NodeKind.Group, '[2] should be Skills group');
    assert.strictEqual(global.children[3].kind, NodeKind.Container, '[3] should be Projects folder');
    assert.strictEqual((global.children[3] as ContainerNodeDescriptor).containerKind, 'projects');
    assert.strictEqual(global.children[4].kind, NodeKind.Container, '[4] should be Plugins folder');
    assert.strictEqual((global.children[4] as ContainerNodeDescriptor).containerKind, 'plugins');
  });

  it('AC-PLUG-GLOBAL-5: Plugins folder is absent from Global when no plugin assets', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(global, 'expected Global container');
    const pluginsChild = global.children.find(c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins');
    assert.strictEqual(pluginsChild, undefined, 'No Plugins folder inside Global when no plugin assets');
    // Only the Skills group is present
    assert.strictEqual(global.children.length, 1, 'Global should have 1 child (Skills group) when no plugins');
  });
});

// ---------------------------------------------------------------------------
// Backward-compat: existing AC12/AC14 tests relied on nodes having .kind NodeKind.Group
// at the top level. Now top-level nodes are Container. Verify the Group nodes still
// exist as children (nested), not at the top.
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- type groups are nested, not top-level', () => {
  it('top-level nodes are Container kind, not Group kind', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    for (const node of nodes) {
      assert.notStrictEqual(node.kind, NodeKind.Group, 'top-level nodes should not be Group kind');
    }
  });

  it('type groups appear at level 2 inside a container', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const globalContainer = nodes[0] as ContainerNodeDescriptor;
    const firstChild = globalContainer.children[0];
    assert.strictEqual(firstChild.kind, NodeKind.Group, 'level-2 nodes inside container should be Group kind');
  });
});

// ---------------------------------------------------------------------------
// rootPath required on ClaudeAsset
// ---------------------------------------------------------------------------

describe('ClaudeAsset rootPath field', () => {
  it('ClaudeAsset has rootPath field', () => {
    const asset: ClaudeAsset = {
      type: AssetType.Skill,
      name: 'test',
      filePath: '/some/path/SKILL.md',
      scope: AssetScope.Global,
      description: undefined,
      rootPath: '/some'
    };
    assert.strictEqual(asset.rootPath, '/some');
  });
});

// ---------------------------------------------------------------------------
// Plugin metadata helpers (used by both plugin-folder and divider tests)
// ---------------------------------------------------------------------------

// Real path shapes used throughout (cache-only, no marketplace):
//   cache asset: /Users/braden/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/agents/analyzer.md

const INSTALL_PATH_SC = '/Users/braden/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown';
const CACHE_ASSET_SC = `${INSTALL_PATH_SC}/agents/analyzer.md`;
const PLUGINS_CACHE_ROOT = '/Users/braden/.claude/plugins/cache';

function makePluginAsset(name: string, filePath: string): ClaudeAsset {
  return {
    type: AssetType.Subagent,
    name,
    filePath,
    scope: AssetScope.Plugin,
    description: undefined,
    rootPath: PLUGINS_CACHE_ROOT
  };
}

function makeInstalledInfo(name: string, installPath: string, version: string | null = null, lastUpdated = '2025-06-01T00:00:00Z', scope: 'user' | 'project' | 'local' = 'user'): InstalledPluginInfo {
  return { name, id: `${name}@mk`, marketplace: 'mk', version, installPath, lastUpdated, scope };
}

function makePluginMeta(
  installed: Record<string, InstalledPluginInfo>,
  outdatedNames: string[] = []
): PluginMetadataOptions {
  return {
    installedPlugins: new Map(Object.entries(installed)),
    outdated: new Set(outdatedNames)
  };
}

// Helper: get the Plugins folder (now nested inside Global as last child)
function getPluginsContainer(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor | undefined {
  const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
  if (!global) return undefined;
  return global.children.find(c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins') as ContainerNodeDescriptor | undefined;
}

// Collect all PluginFolder descriptors under the Plugins container, flattening the
// marketplace sub-folders (metadata-driven view) or returning direct children (fallback).
function getPluginFolders(nodes: ReturnType<typeof buildTreeNodes>): PluginFolderNodeDescriptor[] {
  const plugins = getPluginsContainer(nodes);
  if (!plugins) return [];
  const out: PluginFolderNodeDescriptor[] = [];
  for (const child of plugins.children) {
    if (child.kind === NodeKind.PluginFolder) {
      out.push(child as PluginFolderNodeDescriptor);
    } else if (child.kind === NodeKind.Container && (child as ContainerNodeDescriptor).containerKind === 'marketplace') {
      for (const f of (child as ContainerNodeDescriptor).children) {
        if (f.kind === NodeKind.PluginFolder) out.push(f as PluginFolderNodeDescriptor);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plugin folder -- direct children of Plugins container (no Installed/Available split)
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- Plugins container (metadata-driven, nested by marketplace)', () => {
  it('AC-TREE-NEW1: plugins are nested under their source marketplace folder', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC) });
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'expected Plugins container');
    assert.ok(plugins.children.length > 0, 'expected at least one marketplace folder');
    const mk = plugins.children[0] as ContainerNodeDescriptor;
    assert.strictEqual(mk.kind, NodeKind.Container);
    assert.strictEqual(mk.containerKind, 'marketplace');
    assert.strictEqual(mk.label, 'mk', 'marketplace folder labelled by source');
    const folder = mk.children[0] as PluginFolderNodeDescriptor;
    assert.strictEqual(folder.kind, NodeKind.PluginFolder);
    assert.strictEqual(folder.pluginName, 'skill-creator');
  });

  it('AC-TREE-NEW2: installed plugins appear under their marketplace, sorted alpha', () => {
    const installPathFD = '/Users/braden/.claude/plugins/cache/claude-plugins-official/frontend-design/1.0.0';
    const meta = makePluginMeta({
      'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC),
      'frontend-design': makeInstalledInfo('frontend-design', installPathFD, '1.0.0')
    });
    const nodes = buildTreeNodes([], meta);
    const folders = getPluginFolders(nodes);
    assert.strictEqual(folders.length, 2, 'expected 2 plugin folders');
    assert.strictEqual(folders[0].pluginName, 'frontend-design');
    assert.strictEqual(folders[1].pluginName, 'skill-creator');
  });

  it('AC-TREE-NEW3: installed plugin with unknown version shows no version text', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC, null) });
    const nodes = buildTreeNodes([], meta);
    const scFolder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(scFolder, 'skill-creator folder should exist');
    assert.strictEqual(scFolder.description, '', `unknown version should render no description. Got: "${scFolder.description}"`);
  });

  it('AC-TREE-NEW3b: installed plugin with version 1.0.0 shows that version in description', () => {
    const installPath = '/Users/braden/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0';
    const meta = makePluginMeta({ 'claude-code-setup': makeInstalledInfo('claude-code-setup', installPath, '1.0.0') });
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'claude-code-setup')!;
    assert.ok(folder, 'claude-code-setup folder should exist');
    assert.ok(folder.description!.includes('1.0.0'), `expected description to include "1.0.0", got: "${folder.description}"`);
  });

  it('AC-TREE-NEW3c: description is version only -- source is the marketplace folder, not the version text', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC, '1.0.0') });
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.strictEqual(folder.description, '1.0.0');
  });

  it('AC-TREE-NEW4: outdated plugin description includes "update available" and outdated flag is true', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC, null) }, ['skill-creator']);
    const nodes = buildTreeNodes([], meta);
    const scFolder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(scFolder.description!.includes('update available'), `Got: "${scFolder.description}"`);
    assert.strictEqual(scFolder.outdated, true, 'PluginFolderNodeDescriptor.outdated should be true');
  });

  it('AC-TREE-NEW5: a plugin folder renders its install directory lazily (dirPath set, no precomputed children)', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC) });
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.strictEqual(folder.dirPath, INSTALL_PATH_SC, 'folder mirrors its install directory');
    assert.strictEqual(folder.children.length, 0, 'children are listed lazily from disk');
  });

  it('AC-TREE-NEW6: without metadata, scanned plugins still show (asset-derived fallback, no description)', () => {
    const assets = [makePluginAsset('p-skill', '/home/user/.claude/plugins/cache/mk/plugin-a/1.0/skills/p-skill/SKILL.md')];
    const nodes = buildTreeNodes(assets);
    const folder = getPluginFolders(nodes)[0];
    assert.strictEqual(folder.kind, NodeKind.PluginFolder, 'should be a PluginFolder');
    assert.strictEqual(folder.pluginName, 'plugin-a');
    assert.strictEqual(folder.description, undefined, 'no metadata -> no description');
  });

  it('AC-TREE-NEW7: no "Installed" or "Available" sections appear under Plugins', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC) });
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    const labels = (plugins.children as ContainerNodeDescriptor[]).map(c => c.label);
    assert.ok(!labels.includes('Installed') && !labels.includes('Available'), 'no Installed/Available sub-sections');
  });

  it('AC-TREE-NEW8: a scanned plugin absent from installed_plugins.json is hidden (uninstalled leftover)', () => {
    const installPathFD = '/Users/braden/.claude/plugins/cache/claude-plugins-official/frontend-design/1.0.0';
    const assetFD = `${installPathFD}/skills/frontend-design/SKILL.md`;
    const assets: ClaudeAsset[] = [
      makePluginAsset('analyzer', CACHE_ASSET_SC), // skill-creator, NOT in metadata
      { type: AssetType.Skill, name: 'frontend-design', filePath: assetFD, scope: AssetScope.Plugin, description: undefined, rootPath: PLUGINS_CACHE_ROOT }
    ];
    const meta = makePluginMeta({ 'frontend-design': makeInstalledInfo('frontend-design', installPathFD, '1.0.0') });
    const nodes = buildTreeNodes(assets, meta);
    const names = getPluginFolders(nodes).map(f => f.pluginName);
    assert.deepStrictEqual(names, ['frontend-design'], 'only plugins in installed_plugins.json should show');
  });

  it('AC-TREE-NEW9: an installed plugin with no scanned assets still shows (metadata-driven)', () => {
    const installPath = '/Users/braden/.claude/plugins/cache/claude-plugins-official/frontend-design/1.0.0';
    const meta = makePluginMeta({ 'frontend-design': makeInstalledInfo('frontend-design', installPath, '1.0.0') });
    const nodes = buildTreeNodes([], meta); // no assets scanned at all
    const names = getPluginFolders(nodes).map(f => f.pluginName);
    assert.deepStrictEqual(names, ['frontend-design'], 'installed plugin shows even with no browsable assets');
  });
});

// ---------------------------------------------------------------------------
// Working Directory container holding project folders
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- Working Directory container', () => {
  it('AC-WD1: Working Directory container appears after Global when projects exist; projects nested inside', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makePluginAsset('p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md'),
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);

    // No top-level Plugins container -- it lives inside Global
    const topLevelPlugins = nodes.find(n => n.kind === NodeKind.Container && (n as ContainerNodeDescriptor).containerKind === 'plugins');
    assert.strictEqual(topLevelPlugins, undefined, 'Plugins must NOT be at top level');

    // No top-level project containers -- they live inside Working Directory
    const topLevelProjects = (nodes as ContainerNodeDescriptor[]).filter(n => n.kind === NodeKind.Container && n.containerKind === 'project');
    assert.strictEqual(topLevelProjects.length, 0, 'projects must NOT be at top level');

    const globalIdx = nodes.findIndex(n => n.kind === NodeKind.Container && (n as ContainerNodeDescriptor).containerKind === 'global');
    const wdIdx = nodes.findIndex(n => n.kind === NodeKind.Container && (n as ContainerNodeDescriptor).containerKind === 'working-directory');
    assert.ok(wdIdx > globalIdx, 'Working Directory should appear after Global');

    const projects = getProjects(nodes);
    assert.deepStrictEqual(projects.map(p => p.label), ['MyApp']);
  });

  it('AC-WD2: No Working Directory container when no projects exist (global + plugins only)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makePluginAsset('p-skill', '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md')
    ];
    const nodes = buildTreeNodes(assets);
    assert.strictEqual(getWorkingDir(nodes), undefined, 'no Working Directory when no projects exist');
  });

  it('AC-WD3: No Working Directory when only global assets exist', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    assert.strictEqual(getWorkingDir(nodes), undefined, 'no Working Directory when no projects exist');
  });

  it('AC-WD4: Working Directory appears even when no Plugins (only Global + projects)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const wd = getWorkingDir(nodes);
    assert.ok(wd, 'Working Directory should appear when projects exist even without plugins');
    assert.deepStrictEqual(getProjects(nodes).map(p => p.label), ['MyApp']);
  });

  it('AC-WD4b: a workspace with no .claude still shows the always-on type groups (create/drop targets)', () => {
    const meta = { ensureWorkingDirBase: '/ws/fresh/.claude' } as unknown as PluginMetadataOptions;
    const wd = getWorkingDir(buildTreeNodes([], meta));
    assert.ok(wd, 'WD container present for an open workspace even with no assets');
    const groupTypes = (wd!.children as Array<{ kind: NodeKind; assetType?: AssetType }>)
      .filter(c => c.kind === NodeKind.Group)
      .map(g => g.assetType);
    // Skill, Subagent, and Command groups are always shown, so a fresh project has somewhere to drop each.
    for (const t of [AssetType.Skill, AssetType.Subagent, AssetType.Command]) {
      assert.ok(groupTypes.includes(t), `expected an empty ${t} group as a drop/create target`);
    }
  });

  it('AC-WD5: Working Directory label is "Working Directory"', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const wd = getWorkingDir(nodes);
    assert.ok(wd, 'expected Working Directory container');
    assert.strictEqual(wd!.label, 'Working Directory');
  });

  it('AC-WD5b: sub-project folders carry their root path (so assets can be drag-copied onto them)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 's', '/Users/braden/Projects/MyApp/.claude/skills/s/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const proj = findProject(buildTreeNodes(assets), 'MyApp');
    assert.ok(proj, 'expected MyApp sub-project');
    assert.strictEqual(proj!.dirPath, '/Users/braden/Projects/MyApp', 'sub-project carries its root dir');
  });

  it('AC-WD6: root-level assets (the working dir own .claude) render flat at the WD root, not in a self-named folder', () => {
    const assets: ClaudeAsset[] = [
      // sub-project beneath the workspace root
      makeAsset(AssetType.Skill, 'a-skill', '/Users/braden/Projects/Alpha/.claude/skills/a-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      // the working dir's OWN .claude config (directly under the workspace root)
      makeAsset(AssetType.Config, 'settings.local.json', '/Users/braden/Projects/.claude/settings.local.json', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const wd = getWorkingDir(nodes)!;
    assert.ok(wd, 'expected Working Directory container');

    // settings.local.json is a direct Asset leaf of Working Directory (no wrapping folder)
    const leaf = wd.children.find(c => c.kind === NodeKind.Asset) as AssetNodeDescriptor | undefined;
    assert.ok(leaf, 'root-level config should be a direct leaf under Working Directory');
    assert.strictEqual(leaf!.asset.name, 'settings.local.json');

    // No self-named "Projects" folder; Alpha sub-project is still a folder
    assert.ok(!getProjects(nodes).some(p => p.label === 'Projects'), 'no self-named Projects folder for the root');
    assert.ok(findProject(nodes, 'Alpha'), 'Alpha sub-project should still be a folder');
  });
});

// ---------------------------------------------------------------------------
// Worktree grouping within project containers
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- worktree asset grouping', () => {
  // Helper: get a project container by label (projects live under the Working Directory container)
  function getProject(nodes: ReturnType<typeof buildTreeNodes>, label: string): ContainerNodeDescriptor {
    const c = findProject(nodes, label);
    assert.ok(c, `expected project container '${label}'`);
    return c!;
  }

  it('AC-TREE-WT-1: project with only main assets has no WorktreesFolder child', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder);
    assert.strictEqual(worktreesFolder, undefined, 'no WorktreesFolder when no worktree assets');
  });

  it('AC-TREE-WT-2: project with worktree assets has WorktreesFolder as last child', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const lastChild = proj.children[proj.children.length - 1];
    assert.strictEqual(lastChild.kind, NodeKind.WorktreesFolder, 'WorktreesFolder should be last child of project container');
  });

  it('AC-TREE-WT-2b: project with ONLY worktree assets has WorktreesFolder as only child', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    assert.strictEqual(proj.children.length, 1, 'only WorktreesFolder child when no main assets');
    assert.strictEqual(proj.children[0].kind, NodeKind.WorktreesFolder);
  });

  it('AC-TREE-WT-3: WorktreesFolder has correct kind, label Worktrees, and WorktreeNameFolder children sorted alpha', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/worktrees/zebra-wt/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'bar', '/Users/braden/Projects/Workouts/.claude/worktrees/alpha-wt/.claude/skills/bar/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    assert.ok(worktreesFolder, 'expected WorktreesFolder');
    assert.strictEqual(worktreesFolder.kind, NodeKind.WorktreesFolder);
    assert.strictEqual(worktreesFolder.label, 'worktrees');
    // Children sorted alpha
    assert.strictEqual(worktreesFolder.children[0].kind, NodeKind.WorktreeNameFolder);
    assert.strictEqual(worktreesFolder.children[0].label, 'alpha-wt');
    assert.strictEqual(worktreesFolder.children[1].label, 'zebra-wt');
  });

  it('AC-TREE-WT-4: WorktreeNameFolder has correct kind, label, and type-group children', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Subagent, 'bar', '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/agents/bar.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    assert.ok(worktreesFolder);
    const wtNameFolder = worktreesFolder.children[0] as WorktreeNameFolderNodeDescriptor;
    assert.strictEqual(wtNameFolder.kind, NodeKind.WorktreeNameFolder);
    assert.strictEqual(wtNameFolder.label, 'agent-ac745f103f192bf4f');
    // Should have type-group children (Skill and Subagent)
    const groupTypes = wtNameFolder.children.map(g => (g as GroupNodeDescriptor).assetType);
    assert.ok(groupTypes.includes(AssetType.Skill), 'worktree name folder should have Skills group');
    assert.ok(groupTypes.includes(AssetType.Subagent), 'worktree name folder should have Subagents group');
    // Canonical order: Skill before Subagent
    assert.ok(groupTypes.indexOf(AssetType.Skill) < groupTypes.indexOf(AssetType.Subagent));
  });

  it('AC-TREE-WT-5: main and worktree assets are separated -- no duplication', () => {
    // Uses Command assets (Skills/Agents now render lazily from disk and carry no descriptor children).
    const mainPath = '/Users/braden/Projects/Workouts/.claude/commands/foo.md';
    const wtPath = '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/commands/foo.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'foo', mainPath, AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Command, 'foo', wtPath, AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');

    // Collect all asset file paths at the direct type-group level (main)
    const mainGroups = proj.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    const mainPaths: string[] = [];
    for (const g of mainGroups) {
      for (const a of g.children as AssetNodeDescriptor[]) {
        mainPaths.push(a.filePath);
      }
    }

    // Collect all asset file paths inside the worktree folder
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    const wtPaths: string[] = [];
    for (const wtName of worktreesFolder.children) {
      for (const g of (wtName as WorktreeNameFolderNodeDescriptor).children as GroupNodeDescriptor[]) {
        for (const a of g.children as AssetNodeDescriptor[]) {
          wtPaths.push(a.filePath);
        }
      }
    }

    // Main section contains only the main path
    assert.ok(mainPaths.includes(mainPath), 'main asset should be in main section');
    assert.ok(!mainPaths.includes(wtPath), 'worktree asset must NOT appear in main section');

    // Worktree section contains only the worktree path
    assert.ok(wtPaths.includes(wtPath), 'worktree asset should be in worktree section');
    assert.ok(!wtPaths.includes(mainPath), 'main asset must NOT appear in worktree section');
  });

  it('AC-TREE-WT-6: multiple worktrees within same project each get their own WorktreeNameFolder, sorted alpha', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/worktrees/zebra-wt/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'bar', '/Users/braden/Projects/Workouts/.claude/worktrees/alpha-wt/.claude/skills/bar/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'baz', '/Users/braden/Projects/Workouts/.claude/worktrees/middle-wt/.claude/skills/baz/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    assert.ok(worktreesFolder);
    assert.strictEqual(worktreesFolder.children.length, 3, 'expected 3 worktree name folders');
    assert.strictEqual(worktreesFolder.children[0].label, 'alpha-wt');
    assert.strictEqual(worktreesFolder.children[1].label, 'middle-wt');
    assert.strictEqual(worktreesFolder.children[2].label, 'zebra-wt');
  });

  it('AC-TREE-WT-7: WorktreesFolderNodeDescriptor and WorktreeNameFolderNodeDescriptor have non-asset contextValues', () => {
    // These are descriptor tests -- the actual contextValues are set in nodes.ts.
    // Here we verify the NodeKinds are correct so callers can set the right values.
    // (contextValue is set in the node class; we verify kind here.)
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    assert.ok(worktreesFolder, 'WorktreesFolder should exist');
    assert.strictEqual(worktreesFolder.kind, NodeKind.WorktreesFolder, 'kind must be WorktreesFolder');
    assert.strictEqual(worktreesFolder.children[0].kind, NodeKind.WorktreeNameFolder, 'child kind must be WorktreeNameFolder');
  });

  it('AC-TREE-WT-8: asset nodes inside worktree group have correct commandId and contextValue', () => {
    const skillPath = '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/commands/foo.md';
    const configPath = '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/settings.json';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'foo', skillPath, AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Config, 'settings.json', configPath, AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Workouts');
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    const wtName = worktreesFolder.children[0] as WorktreeNameFolderNodeDescriptor;

    // Collect all asset nodes: flat leaves (kind Asset) directly on wtName.children,
    // and grouped leaves inside GroupNodeDescriptor children
    const allAssets: AssetNodeDescriptor[] = [];
    for (const child of wtName.children) {
      if (child.kind === NodeKind.Asset) {
        allAssets.push(child as AssetNodeDescriptor);
      } else {
        const g = child as GroupNodeDescriptor;
        for (const a of g.children as AssetNodeDescriptor[]) {
          allAssets.push(a);
        }
      }
    }

    const skillNode = allAssets.find(a => a.filePath === skillPath);
    const configNode = allAssets.find(a => a.filePath === configPath);
    assert.ok(skillNode, 'skill asset node should exist in worktree group');
    assert.ok(configNode, 'config asset node should exist in worktree group');
    assert.strictEqual(skillNode!.commandId, 'claudeAssets.openMarkdown', 'markdown leaf should use openMarkdown');
    assert.ok(skillNode!.contextValue.includes('-md-'), 'skill should have -md- contextValue');
    assert.strictEqual(configNode!.commandId, 'claudeAssets.openFile', 'config should use openFile');
    assert.ok(configNode!.contextValue.includes('asset-config'), 'config should have asset-config contextValue');
  });

  it('AC-TREE-WT-9: projects without worktrees are structurally unchanged', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'a-skill', '/Users/braden/Projects/Alpha/.claude/skills/a-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Subagent, 'an-agent', '/Users/braden/Projects/Alpha/.claude/agents/an-agent.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = getProject(nodes, 'Alpha');
    // All children should be Group nodes (no WorktreesFolder)
    for (const child of proj.children) {
      assert.strictEqual(child.kind, NodeKind.Group, 'project with no worktrees should have only Group children');
    }
    const types = (proj.children as GroupNodeDescriptor[]).map(g => g.assetType);
    assert.ok(types.includes(AssetType.Skill));
    assert.ok(types.includes(AssetType.Subagent));
  });
});

// ---------------------------------------------------------------------------
// AC-FLAT: ClaudeMd and Config render as direct leaf nodes (no Group wrapper)
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- flat leaves for ClaudeMd and Config', () => {
  it('AC-FLAT-1: Global -- ClaudeMd and Config are direct AssetNode leaves, no Group wrapper', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', '/home/user/.claude/CLAUDE.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'g-skill', '/home/user/.claude/skills/g-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(global, 'expected Global container');

    // No Group node with assetType ClaudeMd or Config
    const groupChildren = global.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    const claudeMdGroup = groupChildren.find(g => g.assetType === AssetType.ClaudeMd);
    const configGroup = groupChildren.find(g => g.assetType === AssetType.Config);
    assert.strictEqual(claudeMdGroup, undefined, 'ClaudeMd must NOT be wrapped in a Group');
    assert.strictEqual(configGroup, undefined, 'Config must NOT be wrapped in a Group');

    // Direct AssetNodeDescriptor children for ClaudeMd and Config
    const leafChildren = global.children.filter(c => c.kind === NodeKind.Asset) as AssetNodeDescriptor[];
    assert.ok(leafChildren.some(a => a.asset.type === AssetType.ClaudeMd), 'ClaudeMd must be a direct leaf');
    assert.ok(leafChildren.some(a => a.asset.type === AssetType.Config), 'Config must be a direct leaf');

    // Skill still wrapped in Group
    const skillGroup = groupChildren.find(g => g.assetType === AssetType.Skill);
    assert.ok(skillGroup, 'Skill must still be in a Group');
  });

  it('AC-FLAT-2: Ordering -- CLAUDE.md leaf first, Config leaf second, then grouped folders', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', '/home/user/.claude/CLAUDE.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'foo', '/home/user/.claude/skills/foo/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;

    assert.strictEqual(global.children.length, 3, 'expected 3 children: CLAUDE.md leaf, settings.json leaf, Skills group');
    assert.strictEqual(global.children[0].kind, NodeKind.Asset, '[0] should be Asset leaf (CLAUDE.md)');
    assert.strictEqual((global.children[0] as AssetNodeDescriptor).asset.type, AssetType.ClaudeMd, '[0] should be ClaudeMd');
    assert.strictEqual(global.children[1].kind, NodeKind.Asset, '[1] should be Asset leaf (Config)');
    assert.strictEqual((global.children[1] as AssetNodeDescriptor).asset.type, AssetType.Config, '[1] should be Config');
    assert.strictEqual(global.children[2].kind, NodeKind.Group, '[2] should be Skills Group');
    assert.strictEqual((global.children[2] as GroupNodeDescriptor).assetType, AssetType.Skill);
  });

  it('AC-FLAT-3: Multiple Config files -- all direct leaves sorted alpha, before group folders', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Config, 'settings.local.json', '/home/user/.claude/settings.local.json', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'foo', '/home/user/.claude/skills/foo/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;

    // First two children are Config leaves sorted alpha
    assert.strictEqual(global.children[0].kind, NodeKind.Asset);
    assert.strictEqual((global.children[0] as AssetNodeDescriptor).label, 'settings.json');
    assert.strictEqual(global.children[1].kind, NodeKind.Asset);
    assert.strictEqual((global.children[1] as AssetNodeDescriptor).label, 'settings.local.json');
    // Third is the Skills group
    assert.strictEqual(global.children[2].kind, NodeKind.Group);
  });

  it('AC-FLAT-4: Project container -- ClaudeMd and Config are direct leaves, Skill is grouped', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', '/Users/braden/Projects/MyApp/.claude/CLAUDE.md', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Config, 'settings.local.json', '/Users/braden/Projects/MyApp/.claude/settings.local.json', AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'foo', '/Users/braden/Projects/MyApp/.claude/skills/foo/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = findProject(nodes, 'MyApp')!;
    assert.ok(proj, 'expected MyApp project container');

    // Flatten: CLAUDE.md leaf, settings.local.json leaf, Skills group
    assert.strictEqual(proj.children[0].kind, NodeKind.Asset);
    assert.strictEqual((proj.children[0] as AssetNodeDescriptor).asset.type, AssetType.ClaudeMd);
    assert.strictEqual(proj.children[1].kind, NodeKind.Asset);
    assert.strictEqual((proj.children[1] as AssetNodeDescriptor).asset.type, AssetType.Config);
    assert.strictEqual(proj.children[2].kind, NodeKind.Group);
    assert.strictEqual((proj.children[2] as GroupNodeDescriptor).assetType, AssetType.Skill);

    // No Group for ClaudeMd or Config
    const groups = proj.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    assert.ok(!groups.some(g => g.assetType === AssetType.ClaudeMd), 'no ClaudeMd group in project');
    assert.ok(!groups.some(g => g.assetType === AssetType.Config), 'no Config group in project');
  });

  it('AC-FLAT-5: WorktreeNameFolder -- CLAUDE.md leaf first, then Skill group', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md',
        '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/CLAUDE.md',
        AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'foo',
        '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/skills/foo/SKILL.md',
        AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const proj = findProject(nodes, 'Workouts')!;
    const worktreesFolder = proj.children.find(c => c.kind === NodeKind.WorktreesFolder) as WorktreesFolderNodeDescriptor;
    assert.ok(worktreesFolder, 'expected WorktreesFolder');
    const wtName = worktreesFolder.children[0] as WorktreeNameFolderNodeDescriptor;
    assert.strictEqual(wtName.label, 'wt1');

    // Children: CLAUDE.md leaf first, then Skills group
    assert.strictEqual(wtName.children[0].kind, NodeKind.Asset, '[0] should be CLAUDE.md leaf');
    assert.strictEqual((wtName.children[0] as AssetNodeDescriptor).asset.type, AssetType.ClaudeMd);
    assert.strictEqual(wtName.children[1].kind, NodeKind.Group, '[1] should be Skills group');
  });

  it('AC-FLAT-6: Grouped types (Skill, Subagent, Command) are still wrapped in Group nodes', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', '/home/user/.claude/skills/foo/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Subagent, 'bar', '/home/user/.claude/agents/bar.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const groups = global.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    assert.ok(groups.some(g => g.assetType === AssetType.Skill), 'Skill must be in a Group');
    assert.ok(groups.some(g => g.assetType === AssetType.Subagent), 'Subagent must be in a Group');
    // No direct Asset leaves (no ClaudeMd/Config in this input)
    const leaves = global.children.filter(c => c.kind === NodeKind.Asset);
    assert.strictEqual(leaves.length, 0, 'no direct leaves when only grouped types');
  });

  it('AC-FLAT: flat leaf nodes have correct commandId and contextValue (CLAUDE.md -> openMarkdown, Config -> openFile)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', '/home/user/.claude/CLAUDE.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const leaves = global.children as AssetNodeDescriptor[];

    const claudeMd = leaves.find(a => a.asset.type === AssetType.ClaudeMd)!;
    assert.ok(claudeMd, 'expected CLAUDE.md leaf');
    assert.strictEqual(claudeMd.commandId, 'claudeAssets.openMarkdown', 'CLAUDE.md should use openMarkdown');
    assert.ok(claudeMd.contextValue.includes('-md-'), 'CLAUDE.md contextValue should contain -md-');

    const config = leaves.find(a => a.asset.type === AssetType.Config)!;
    assert.ok(config, 'expected Config leaf');
    assert.strictEqual(config.commandId, 'claudeAssets.openFile', 'Config should use openFile');
    assert.ok(config.contextValue.startsWith('asset-config'), 'Config contextValue should start with asset-config');
  });
});

// ---------------------------------------------------------------------------
// AC-GUARD: buildTreeNodes defensive guard for missing/partial pluginMeta
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- defensive guard for missing pluginMeta', () => {
  const pluginAsset = makeAsset(
    AssetType.Skill, 'p-skill',
    '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md',
    AssetScope.Plugin, '/home/user/.claude/plugins'
  );

  it('AC-GUARD-1: calling buildTreeNodes(assets) with no second arg does not throw', () => {
    const assets: ClaudeAsset[] = [pluginAsset];
    let result: ReturnType<typeof buildTreeNodes> | undefined;
    assert.doesNotThrow(() => {
      result = buildTreeNodes(assets);
    }, 'buildTreeNodes with no pluginMeta should not throw');
    assert.ok(result, 'expected a result');
    // Plugins folder is now inside Global, not top-level
    const pluginsContainer = getPluginsContainer(result!);
    assert.ok(pluginsContainer, 'Plugins folder should still be present inside Global');
    // Plugin folder should have no description
    const folder = pluginsContainer!.children[0] as PluginFolderNodeDescriptor;
    assert.strictEqual(folder.description, undefined, 'no description without metadata');
  });

  it('AC-GUARD-2: calling buildTreeNodes(assets, {}) with empty object does not throw', () => {
    const assets: ClaudeAsset[] = [pluginAsset];
    let result: ReturnType<typeof buildTreeNodes> | undefined;
    assert.doesNotThrow(() => {
      // Cast to bypass TypeScript -- callers may pass a partial object at runtime
      result = buildTreeNodes(assets, {} as PluginMetadataOptions);
    }, 'buildTreeNodes with empty pluginMeta object should not throw');
    assert.ok(result, 'expected a result');
    // Plugins folder is now inside Global, not top-level
    const pluginsContainer = getPluginsContainer(result!);
    assert.ok(pluginsContainer, 'Plugins folder should still be present inside Global');
    // Plugin folder should have no description (no installedPlugins map to look up)
    const folder = pluginsContainer!.children[0] as PluginFolderNodeDescriptor;
    assert.strictEqual(folder.description, undefined, 'no description with empty pluginMeta');
  });
});

// ---------------------------------------------------------------------------
// AC-EN-3..5: enabled/disabled plugin descriptor rendering
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- plugin enabled/disabled state', () => {
  // Local meta builder that accepts an optional enabled map
  function makePluginMetaWithEnabled(
    installed: Record<string, InstalledPluginInfo>,
    outdatedNames: string[] = [],
    enabledMap?: Map<string, boolean>
  ): PluginMetadataOptions {
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(Object.entries(installed)),
      outdated: new Set(outdatedNames),
      ...(enabledMap !== undefined ? { enabled: enabledMap } : {})
    };
    return meta;
  }

  it('AC-EN-3: disabled plugin descriptor has enabled===false and description ends with " (disabled)"', () => {
    const info = makeInstalledInfo('skill-creator', INSTALL_PATH_SC, '1.0.0');
    const enabledMap = new Map<string, boolean>([['skill-creator@mk', false]]);
    const meta = makePluginMetaWithEnabled({ 'skill-creator': info }, [], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(folder, 'skill-creator folder should exist');
    assert.strictEqual(folder.enabled, false, 'enabled should be false');
    assert.ok(folder.description && folder.description.endsWith(' (disabled)'),
      `description should end with " (disabled)", got: "${folder.description}"`);
  });

  it('AC-EN-4a: plugin mapped to true has enabled===true and NO " (disabled)" suffix', () => {
    const info = makeInstalledInfo('skill-creator', INSTALL_PATH_SC, '1.0.0');
    const enabledMap = new Map<string, boolean>([['skill-creator@mk', true]]);
    const meta = makePluginMetaWithEnabled({ 'skill-creator': info }, [], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(folder, 'skill-creator folder should exist');
    assert.strictEqual(folder.enabled, true, 'enabled should be true');
    assert.ok(folder.description && !folder.description.includes('(disabled)'),
      `description should NOT contain "(disabled)", got: "${folder.description}"`);
  });

  it('AC-EN-4b: plugin absent from enabled map has enabled===true and NO " (disabled)" suffix', () => {
    const info = makeInstalledInfo('skill-creator', INSTALL_PATH_SC, '1.0.0');
    // Pass a non-empty enabled map but WITHOUT this plugin's id
    const enabledMap = new Map<string, boolean>([['other@mk', true]]);
    const meta = makePluginMetaWithEnabled({ 'skill-creator': info }, [], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.strictEqual(folder.enabled, true, 'absent id defaults to enabled');
    assert.ok(folder.description && !folder.description.includes('(disabled)'),
      `description should NOT contain "(disabled)", got: "${folder.description}"`);
  });

  it('AC-EN-4c: no enabled map -> descriptor.enabled is undefined; description is version only (AC-TREE-NEW3c stays green)', () => {
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC, '1.0.0') });
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.strictEqual(folder.enabled, undefined, 'no enabled map -> undefined');
    assert.strictEqual(folder.description, '1.0.0', 'description must be exactly the version string');
  });

  it('AC-EN-5: disabled + outdated plugin description contains both "update available" and "(disabled)"', () => {
    const info = makeInstalledInfo('skill-creator', INSTALL_PATH_SC, '1.0.0');
    const enabledMap = new Map<string, boolean>([['skill-creator@mk', false]]);
    const meta = makePluginMetaWithEnabled({ 'skill-creator': info }, ['skill-creator'], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const folder = getPluginFolders(nodes).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(folder.description && folder.description.includes('update available'),
      `description should contain "update available", got: "${folder.description}"`);
    assert.ok(folder.description && folder.description.includes('(disabled)'),
      `description should contain "(disabled)", got: "${folder.description}"`);
    assert.strictEqual(folder.enabled, false, 'enabled should be false');
    assert.strictEqual(folder.outdated, true, 'outdated should be true');
  });
});

// ---------------------------------------------------------------------------
// AC-MK: known_marketplaces.json integration -- always show configured marketplaces
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- known marketplaces (always visible)', () => {
  // Builder that accepts an optional marketplaces map -- does NOT touch existing makePluginMeta call sites.
  function makePluginMetaWithMarketplaces(
    installed: Record<string, InstalledPluginInfo>,
    outdatedNames: string[] = [],
    marketplaces?: Map<string, MarketplaceInfo>
  ): PluginMetadataOptions {
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(Object.entries(installed)),
      outdated: new Set(outdatedNames),
      ...(marketplaces !== undefined ? { marketplaces } : {})
    };
    return meta;
  }

  function makeMarketplaceInfo(name: string, installLocation = ''): MarketplaceInfo {
    return { name, installLocation, lastUpdated: '' };
  }

  it('AC-MK-2: marketplaces map with an empty marketplace -> Plugins container has a marketplace folder with children.length===0', () => {
    const installedInfo = makeInstalledInfo('skill-creator', INSTALL_PATH_SC);
    const marketplaces = new Map<string, MarketplaceInfo>([
      ['mk', makeMarketplaceInfo('mk', '/p/mk')],
      ['empty-mk', makeMarketplaceInfo('empty-mk', '/p/empty-mk')]
    ]);
    const meta = makePluginMetaWithMarketplaces({ 'skill-creator': installedInfo }, [], marketplaces);
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes);
    assert.ok(plugins, 'expected Plugins container');
    const emptyMk = (plugins!.children as ContainerNodeDescriptor[]).find(c => c.label === 'empty-mk');
    assert.ok(emptyMk, 'expected empty-mk marketplace folder');
    assert.strictEqual(emptyMk!.containerKind, 'marketplace');
    assert.strictEqual(emptyMk!.children.length, 0, 'empty marketplace should have no plugin children');
  });

  it('AC-MK-3: empty installedPlugins + non-empty marketplaces -> Global container has a plugins container child', () => {
    const marketplaces = new Map<string, MarketplaceInfo>([
      ['some-mk', makeMarketplaceInfo('some-mk', '/p/some-mk')]
    ]);
    const meta = makePluginMetaWithMarketplaces({}, [], marketplaces);
    const nodes = buildTreeNodes([], meta);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
    assert.ok(global, 'Global container should appear when there are known marketplaces');
    const pluginsChild = global!.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins'
    );
    assert.ok(pluginsChild, 'Global should have a plugins container child when marketplaces are configured');
  });

  it('AC-MK-4: one populated marketplace (via installed plugin) + one empty known marketplace -> both folders present; populated keeps its plugin children', () => {
    const installedInfo = makeInstalledInfo('skill-creator', INSTALL_PATH_SC);
    const marketplaces = new Map<string, MarketplaceInfo>([
      ['mk', makeMarketplaceInfo('mk', '/p/mk')],
      ['empty-mk', makeMarketplaceInfo('empty-mk', '/p/empty-mk')]
    ]);
    const meta = makePluginMetaWithMarketplaces({ 'skill-creator': installedInfo }, [], marketplaces);
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes);
    assert.ok(plugins, 'expected Plugins container');

    const mkFolder = (plugins!.children as ContainerNodeDescriptor[]).find(c => c.label === 'mk');
    const emptyMkFolder = (plugins!.children as ContainerNodeDescriptor[]).find(c => c.label === 'empty-mk');

    assert.ok(mkFolder, 'populated marketplace folder should be present');
    assert.ok(emptyMkFolder, 'empty marketplace folder should also be present');

    // populated marketplace has its plugin folder children
    assert.ok(mkFolder!.children.length > 0, 'populated marketplace should have plugin children');
    const pluginFolderChild = mkFolder!.children.find(c => c.kind === NodeKind.PluginFolder) as PluginFolderNodeDescriptor | undefined;
    assert.ok(pluginFolderChild, 'populated marketplace should contain a PluginFolder child');
    assert.strictEqual(pluginFolderChild!.pluginName, 'skill-creator');
  });

  it('AC-MK-5: empty marketplace folder description is "(no plugins installed)"', () => {
    const marketplaces = new Map<string, MarketplaceInfo>([
      ['empty-mk', makeMarketplaceInfo('empty-mk', '/p/empty-mk')]
    ]);
    const meta = makePluginMetaWithMarketplaces({}, [], marketplaces);
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes);
    assert.ok(plugins, 'expected Plugins container');
    const emptyMk = (plugins!.children as ContainerNodeDescriptor[]).find(c => c.label === 'empty-mk');
    assert.ok(emptyMk, 'expected empty-mk marketplace folder');
    assert.strictEqual(emptyMk!.description, '(no plugins installed)', 'empty marketplace description should be "(no plugins installed)"');
  });

  it('AC-MK-6 (back-compat): passing meta WITHOUT marketplaces still derives marketplaces only from installed plugins', () => {
    // This uses the unmodified makePluginMeta -- no marketplaces field
    const meta = makePluginMeta({ 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC) });
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'Plugins container should exist');
    // Only the 'mk' marketplace derived from the installed plugin
    const mkFolders = (plugins.children as ContainerNodeDescriptor[]).filter(c => c.containerKind === 'marketplace');
    assert.strictEqual(mkFolders.length, 1, 'exactly 1 marketplace derived from installed plugin');
    assert.strictEqual(mkFolders[0].label, 'mk');
  });
});

// ---------------------------------------------------------------------------
// AC-CNT: enabled-count summary on Plugins root and per-marketplace containers
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- enabled-count summary (X/Y enabled)', () => {
  // Local meta builder with enabled map support (reuses makePluginMetaWithEnabled pattern from AC-EN tests)
  function makePluginMetaWithEnabled(
    installed: Record<string, InstalledPluginInfo>,
    outdatedNames: string[] = [],
    enabledMap?: Map<string, boolean>
  ): PluginMetadataOptions {
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(Object.entries(installed)),
      outdated: new Set(outdatedNames),
      ...(enabledMap !== undefined ? { enabled: enabledMap } : {})
    };
    return meta;
  }

  // Helper: get the 'mk' marketplace container from inside the Plugins container
  function getMkContainer(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor | undefined {
    const plugins = getPluginsContainer(nodes);
    if (!plugins) return undefined;
    return (plugins.children as ContainerNodeDescriptor[]).find(c => c.containerKind === 'marketplace' && c.label === 'mk');
  }

  it('AC-CNT-1: 2 installed plugins (1 disabled) -> Plugins root description includes "1/2 enabled"', () => {
    const infoA = makeInstalledInfo('a', '/p/cache/mk/a/1.0');
    const infoB = makeInstalledInfo('b', '/p/cache/mk/b/1.0');
    const enabledMap = new Map<string, boolean>([['a@mk', true], ['b@mk', false]]);
    const meta = makePluginMetaWithEnabled({ a: infoA, b: infoB }, [], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'expected Plugins container');
    assert.ok(
      plugins.description && plugins.description.includes('1/2 enabled'),
      `Plugins root description should include "1/2 enabled", got: "${plugins.description}"`
    );
  });

  it('AC-CNT-2: marketplace container with 2 installed plugins (1 disabled) -> marketplace description includes "1/2 enabled"', () => {
    const infoA = makeInstalledInfo('a', '/p/cache/mk/a/1.0');
    const infoB = makeInstalledInfo('b', '/p/cache/mk/b/1.0');
    const enabledMap = new Map<string, boolean>([['a@mk', true], ['b@mk', false]]);
    const meta = makePluginMetaWithEnabled({ a: infoA, b: infoB }, [], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const mk = getMkContainer(nodes)!;
    assert.ok(mk, 'expected mk marketplace container');
    assert.ok(
      mk.description && mk.description.includes('1/2 enabled'),
      `Marketplace description should include "1/2 enabled", got: "${mk.description}"`
    );
  });

  it('AC-CNT-3: marketplace with 1 outdated plugin AND 1 disabled plugin -> description contains both "enabled" and "update"', () => {
    const infoA = makeInstalledInfo('a', '/p/cache/mk/a/1.0');
    const infoB = makeInstalledInfo('b', '/p/cache/mk/b/1.0');
    // a is outdated, b is disabled
    const enabledMap = new Map<string, boolean>([['a@mk', true], ['b@mk', false]]);
    const meta = makePluginMetaWithEnabled({ a: infoA, b: infoB }, ['a'], enabledMap);
    const nodes = buildTreeNodes([], meta);
    const mk = getMkContainer(nodes)!;
    assert.ok(mk, 'expected mk marketplace container');
    assert.ok(
      mk.description && mk.description.includes('enabled'),
      `description should contain "enabled", got: "${mk.description}"`
    );
    assert.ok(
      mk.description && mk.description.includes('update'),
      `description should contain "update", got: "${mk.description}"`
    );
  });

  it('AC-CNT-4: meta WITHOUT enabled map -> Plugins root description does NOT include "enabled"', () => {
    const infoA = makeInstalledInfo('a', '/p/cache/mk/a/1.0');
    const infoB = makeInstalledInfo('b', '/p/cache/mk/b/1.0');
    // No enabled map provided
    const meta = makePluginMetaWithEnabled({ a: infoA, b: infoB }, []);
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'expected Plugins container');
    assert.ok(
      !plugins.description || !plugins.description.includes('enabled'),
      `Plugins root description should NOT include "enabled", got: "${plugins.description}"`
    );
  });

  it('AC-CNT-5: empty known marketplace -> description === "(no plugins installed)"', () => {
    const marketplaces = new Map([
      ['empty-mk', { name: 'empty-mk', installLocation: '/p/empty-mk', lastUpdated: '' } as import('../../src/core/pluginMetadata').MarketplaceInfo]
    ]);
    const enabledMap = new Map<string, boolean>();
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(),
      outdated: new Set(),
      enabled: enabledMap,
      marketplaces
    };
    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'expected Plugins container');
    const emptyMk = (plugins.children as ContainerNodeDescriptor[]).find(c => c.label === 'empty-mk');
    assert.ok(emptyMk, 'expected empty-mk marketplace folder');
    assert.strictEqual(emptyMk!.description, '(no plugins installed)', 'empty marketplace description must be "(no plugins installed)"');
  });
});

// ---------------------------------------------------------------------------
// AC3/AC4: project-folder descriptors inside buildMemoryProjectsFolder
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- memory project folder contextValue and dirPath', () => {
  const ROOT = '/home/user/.claude';
  const ENCODED = '-Users-braden-Projects-MyApp';
  const MEM_PATH = `${ROOT}/projects/${ENCODED}/memory/notes.md`;

  it('AC3: project folder descriptor has contextValue "assetProjectFolder" and dirPath ending in the encoded segment', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Memory, 'notes.md', MEM_PATH, AssetScope.Global, ROOT)
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(global, 'expected Global container');
    const projectsFolder = global.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'projects'
    ) as ContainerNodeDescriptor | undefined;
    assert.ok(projectsFolder, 'expected projects folder inside Global');

    const projectFolder = projectsFolder!.children[0] as ContainerNodeDescriptor;
    assert.strictEqual(projectFolder.kind, NodeKind.Container);
    assert.strictEqual(projectFolder.containerKind, 'project');
    assert.strictEqual(projectFolder.contextValue, 'assetProjectFolder',
      'project folder must have contextValue "assetProjectFolder"');
    assert.ok(projectFolder.dirPath !== undefined, 'project folder must have a dirPath');
    assert.ok(
      projectFolder.dirPath!.endsWith(ENCODED),
      `dirPath should end with encoded segment "${ENCODED}", got: "${projectFolder.dirPath}"`
    );
  });

  it('AC4: project folder with underivable asset path still builds without throwing (dirPath may be undefined)', () => {
    // filePath with no /.claude/projects/ marker -> deriveMemoryProjectDir returns undefined
    const badPath = '/some/weird/path/notes.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Memory, 'notes.md', badPath, AssetScope.Global, ROOT)
    ];
    let nodes: ReturnType<typeof buildTreeNodes> | undefined;
    assert.doesNotThrow(() => {
      nodes = buildTreeNodes(assets);
    }, 'buildTreeNodes must not throw when dirPath cannot be derived');

    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const projectsFolder = global.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'projects'
    ) as ContainerNodeDescriptor | undefined;
    assert.ok(projectsFolder, 'expected projects folder');
    const projectFolder = projectsFolder!.children[0] as ContainerNodeDescriptor;
    assert.strictEqual(projectFolder.contextValue, 'assetProjectFolder',
      'contextValue must be set even when dirPath is undefined');
    // dirPath may be undefined; no crash is the assertion
    assert.strictEqual(projectFolder.dirPath, undefined, 'dirPath should be undefined when path has no projects marker');
  });
});

// ---------------------------------------------------------------------------
// Project-scoped plugins under the Working Directory tree
// MIGRATED: team/local raw maps + effective = local ?? team ?? true
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- project-scoped plugins under Working Directory', () => {
  const PROJ_CLAUDE_DIR = '/Users/braden/Projects/.claude';
  const CACHE = '/Users/braden/.claude/plugins/cache';

  // Make an InstalledPluginInfo with configurable scope (default 'user')
  function makeInstalledById(
    name: string,
    version: string | null,
    installPath: string,
    scope: 'user' | 'project' | 'local' = 'user',
    marketplace = 'mk'
  ): InstalledPluginInfo {
    return { name, id: `${name}@${marketplace}`, marketplace, version, installPath, lastUpdated: '2025-01-01T00:00:00Z', scope };
  }

  // Helper: get the 'plugins' folder that is the last child of the Working Directory container
  function getProjectPluginsFolder(nodes: ReturnType<typeof buildTreeNodes>): ContainerNodeDescriptor | undefined {
    const wd = getWorkingDir(nodes);
    if (!wd) return undefined;
    return wd.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins'
    ) as ContainerNodeDescriptor | undefined;
  }

  // Helper: collect all WD PluginFolderNodeDescriptors, flattening marketplace children
  function getWdPluginFolders(nodes: ReturnType<typeof buildTreeNodes>): PluginFolderNodeDescriptor[] {
    const folder = getProjectPluginsFolder(nodes);
    if (!folder) return [];
    const out: PluginFolderNodeDescriptor[] = [];
    for (const child of folder.children) {
      if (child.kind === NodeKind.PluginFolder) {
        out.push(child as PluginFolderNodeDescriptor);
      } else if (child.kind === NodeKind.Container && (child as ContainerNodeDescriptor).containerKind === 'marketplace') {
        for (const f of (child as ContainerNodeDescriptor).children) {
          if (f.kind === NodeKind.PluginFolder) out.push(f as PluginFolderNodeDescriptor);
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // AC1: install-membership + marketplace grouping
  // ---------------------------------------------------------------------------

  it('AC1: installs mixing user+project+local -> WD folder has assetProjectMarketplace containers; user installs absent; project/local nested and sorted', () => {
    const userInst = makeInstalledById('user-plugin', '1.0', `${CACHE}/mk/user-plugin/1.0`, 'user');
    const projInst = makeInstalledById('proj-plugin', '2.0', `${CACHE}/mk/proj-plugin/2.0`, 'project');
    const localInst = makeInstalledById('aaa-local', '3.0', `${CACHE}/mk/aaa-local/3.0`, 'local');

    const installedPlugins = new Map([
      ['user-plugin', userInst],
      ['proj-plugin', projInst],
      ['aaa-local', localInst]
    ]);

    const meta: PluginMetadataOptions = {
      installedPlugins,
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getProjectPluginsFolder(nodes)!;
    assert.ok(folder, 'expected plugins folder under WD');
    assert.strictEqual(folder.contextValue, 'assetProjectPluginsRoot');

    // Children of the plugins root should be marketplace containers
    const mkContainers = (folder.children as ContainerNodeDescriptor[]).filter(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'marketplace'
    );
    assert.ok(mkContainers.length > 0, 'expected marketplace containers under WD plugins root');

    // All marketplace containers should have contextValue assetProjectMarketplace
    for (const mk of mkContainers) {
      assert.strictEqual((mk as ContainerNodeDescriptor).contextValue, 'assetProjectMarketplace',
        `marketplace container should have contextValue assetProjectMarketplace, got: "${(mk as ContainerNodeDescriptor).contextValue}"`);
    }

    // user-plugin absent from WD
    const wdNames = getWdPluginFolders(nodes).map(f => f.pluginName);
    assert.ok(!wdNames.includes('user-plugin'), 'user-scope install must NOT appear in WD plugins');
    assert.ok(wdNames.includes('proj-plugin'), 'project-scope install must appear in WD plugins');
    assert.ok(wdNames.includes('aaa-local'), 'local-scope install must appear in WD plugins');

    // Sorted alpha within marketplace: aaa-local before proj-plugin
    const mkFolder = mkContainers[0] as ContainerNodeDescriptor;
    const pluginLabels = (mkFolder.children as PluginFolderNodeDescriptor[]).map(f => f.pluginName);
    assert.ok(pluginLabels.indexOf('aaa-local') < pluginLabels.indexOf('proj-plugin'),
      'plugins within a marketplace should be sorted alpha');
  });

  it('AC1b: multiple marketplaces -> sorted alpha', () => {
    const instZebra = makeInstalledById('p1', '1.0', `${CACHE}/zebra-mk/p1/1.0`, 'project', 'zebra-mk');
    const instAlpha = makeInstalledById('p2', '1.0', `${CACHE}/alpha-mk/p2/1.0`, 'local', 'alpha-mk');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['p1', instZebra], ['p2', instAlpha]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getProjectPluginsFolder(nodes)!;
    const mkLabels = (folder.children as ContainerNodeDescriptor[]).map(c => c.label);
    assert.ok(mkLabels.indexOf('alpha-mk') < mkLabels.indexOf('zebra-mk'), 'marketplaces sorted alpha');
  });

  // ---------------------------------------------------------------------------
  // AC2 (new spec): scope:project install -> effective enabled/disabled from team/local maps
  // ---------------------------------------------------------------------------

  it('AC2-node-scope: scope:project install, no enablement entries -> node scope project + contextValue TeamOffPersonalOff', () => {
    const inst = makeInstalledById('my-plugin', '1.0', `${CACHE}/mk/my-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['my-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'my-plugin')!;
    assert.ok(folder, 'expected my-plugin folder');
    assert.strictEqual(folder.scope, 'project', 'node scope must equal INSTALL scope');
    // AC3: both undefined -> TeamOff PersonalOff
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOffPersonalOff');
  });

  it('AC2b-node-scope: scope:local install, no enablement entries -> node scope local + contextValue TeamOffPersonalOff', () => {
    const inst = makeInstalledById('local-plugin', '1.0', `${CACHE}/mk/local-plugin/1.0`, 'local');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['local-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'local-plugin')!;
    assert.ok(folder, 'expected local-plugin folder');
    assert.strictEqual(folder.scope, 'local', 'node scope must equal INSTALL scope');
    // AC3: both undefined -> TeamOff PersonalOff
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOffPersonalOff');
  });

  it('AC2c-node-scope: install scope:project, local=false -> effective disabled, contextValue TeamOffPersonalOff', () => {
    // Scope MUST follow the install record; effective state comes from team/local maps
    const inst = makeInstalledById('conflict-plugin', '2.0', `${CACHE}/mk/conflict-plugin/2.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['conflict-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map([['conflict-plugin@mk', false]]),  // local=false -> effective disabled
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'conflict-plugin')!;
    assert.ok(folder, 'expected conflict-plugin folder');
    assert.strictEqual(folder.scope, 'project', 'node scope must be install scope (project)');
    // AC1: team undefined (Off), local=false (Off) -> TeamOffPersonalOff
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOffPersonalOff');
    assert.strictEqual(folder.enabled, false, 'effective disabled because local=false');
  });

  // ---------------------------------------------------------------------------
  // AC1 (new spec): per-scope status -- tooltip + inline description
  // ---------------------------------------------------------------------------

  it('AC1-effective: team=undefined, local=true -> effective enabled; description ends with " · enabled"; tooltip breakdown', () => {
    const inst = makeInstalledById('my-plugin', '1.0', `${CACHE}/mk/my-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['my-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),                                // team = undefined
      projectLocalEnabled: new Map([['my-plugin@mk', true]]),      // local = true
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'my-plugin')!;
    assert.ok(folder, 'expected my-plugin folder');
    assert.strictEqual(folder.enabled, true, 'effective should be true');
    assert.ok(folder.description && folder.description.endsWith(' · enabled'),
      `description should end with " · enabled", got: "${folder.description}"`);
    // AC2: team undefined (Off), local=true (On) -> TeamOffPersonalOn
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOffPersonalOn');
    // Tooltip breakdown
    assert.ok(folder.tooltip, 'expected tooltip');
    assert.ok(folder.tooltip!.includes('Team (project): not set'),
      `tooltip should include "Team (project): not set", got: "${folder.tooltip}"`);
    assert.ok(folder.tooltip!.includes('Just me (local): enabled'),
      `tooltip should include "Just me (local): enabled", got: "${folder.tooltip}"`);
    assert.ok(folder.tooltip!.includes('Effective: enabled'),
      `tooltip should include "Effective: enabled", got: "${folder.tooltip}"`);
  });

  it('AC2-effective: team=true, local=false -> effective disabled; description ends with " · disabled"; tooltip breakdown', () => {
    const inst = makeInstalledById('con-plugin', '2.0', `${CACHE}/mk/con-plugin/2.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['con-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map([['con-plugin@mk', true]]),     // team = true
      projectLocalEnabled: new Map([['con-plugin@mk', false]]),   // local = false -> effective disabled
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'con-plugin')!;
    assert.ok(folder, 'expected con-plugin folder');
    assert.strictEqual(folder.enabled, false, 'effective should be false (local overrides team)');
    assert.ok(folder.description && folder.description.endsWith(' · disabled'),
      `description should end with " · disabled", got: "${folder.description}"`);
    // AC1: team=true (On), local=false (Off) -> TeamOnPersonalOff
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOnPersonalOff');
    assert.ok(folder.tooltip!.includes('Team (project): enabled'),
      `tooltip should include "Team (project): enabled", got: "${folder.tooltip}"`);
    assert.ok(folder.tooltip!.includes('Just me (local): disabled'),
      `tooltip should include "Just me (local): disabled", got: "${folder.tooltip}"`);
    assert.ok(folder.tooltip!.includes('Effective: disabled'),
      `tooltip should include "Effective: disabled", got: "${folder.tooltip}"`);
  });

  it('AC3-effective: neither team nor local set -> effective enabled (default); tooltip "not set" for both', () => {
    const inst = makeInstalledById('neu-plugin', '1.0', `${CACHE}/mk/neu-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['neu-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'neu-plugin')!;
    assert.ok(folder, 'expected neu-plugin folder');
    assert.strictEqual(folder.enabled, true, 'effective should be true (default)');
    assert.ok(folder.description && folder.description.endsWith(' · enabled'),
      `description should end with " · enabled", got: "${folder.description}"`);
    assert.ok(folder.tooltip!.includes('Team (project): not set'),
      `tooltip should include "Team (project): not set", got: "${folder.tooltip}"`);
    assert.ok(folder.tooltip!.includes('Just me (local): not set'),
      `tooltip should include "Just me (local): not set", got: "${folder.tooltip}"`);
    assert.ok(folder.tooltip!.includes('Effective: enabled'),
      `tooltip should include "Effective: enabled", got: "${folder.tooltip}"`);
  });

  // ---------------------------------------------------------------------------
  // AC-CV: contextValue Team/Personal token format (per-scope toggles)
  // ---------------------------------------------------------------------------

  it('AC-CV-1: team=true, local=false -> contextValue TeamOnPersonalOff; effective disabled; tooltip unchanged', () => {
    const inst = makeInstalledById('cv1-plugin', '1.0', `${CACHE}/mk/cv1-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['cv1-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map([['cv1-plugin@mk', true]]),
      projectLocalEnabled: new Map([['cv1-plugin@mk', false]]),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };
    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'cv1-plugin')!;
    assert.ok(folder, 'expected cv1-plugin folder');
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOnPersonalOff');
    assert.strictEqual(folder.enabled, false, 'effective disabled (local=false overrides team=true)');
    assert.ok(folder.tooltip!.includes('Team (project): enabled'), 'tooltip team line');
    assert.ok(folder.tooltip!.includes('Just me (local): disabled'), 'tooltip local line');
    assert.ok(folder.tooltip!.includes('Effective: disabled'), 'tooltip effective line');
  });

  it('AC-CV-2: team=false (or unset), local=true -> contextValue TeamOffPersonalOn', () => {
    const inst = makeInstalledById('cv2-plugin', '1.0', `${CACHE}/mk/cv2-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['cv2-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),                                 // team undefined -> Off
      projectLocalEnabled: new Map([['cv2-plugin@mk', true]]),      // local=true -> On
      projectClaudeDir: PROJ_CLAUDE_DIR
    };
    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'cv2-plugin')!;
    assert.ok(folder, 'expected cv2-plugin folder');
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOffPersonalOn');
  });

  it('AC-CV-3a: both undefined -> contextValue TeamOffPersonalOff; effective true (default)', () => {
    const inst = makeInstalledById('cv3a-plugin', '1.0', `${CACHE}/mk/cv3a-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['cv3a-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };
    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'cv3a-plugin')!;
    assert.ok(folder, 'expected cv3a-plugin folder');
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOffPersonalOff');
    assert.strictEqual(folder.enabled, true, 'effective true (default when both unset)');
  });

  it('AC-CV-3b: both true -> contextValue TeamOnPersonalOn; effective true', () => {
    const inst = makeInstalledById('cv3b-plugin', '1.0', `${CACHE}/mk/cv3b-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['cv3b-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map([['cv3b-plugin@mk', true]]),
      projectLocalEnabled: new Map([['cv3b-plugin@mk', true]]),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };
    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'cv3b-plugin')!;
    assert.ok(folder, 'expected cv3b-plugin folder');
    assert.strictEqual(folder.contextValue, 'assetProjectPluginFolderTeamOnPersonalOn');
    assert.strictEqual(folder.enabled, true, 'effective true when both true');
  });

  it('AC-CV-4: contextValue startsWith assetProjectPluginFolder (uninstall menu still matches)', () => {
    const inst = makeInstalledById('cv4-plugin', '1.0', `${CACHE}/mk/cv4-plugin/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['cv4-plugin', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map([['cv4-plugin@mk', true]]),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };
    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'cv4-plugin')!;
    assert.ok(folder, 'expected cv4-plugin folder');
    assert.ok(
      folder.contextValue && folder.contextValue.startsWith('assetProjectPluginFolder'),
      `contextValue must start with "assetProjectPluginFolder", got: "${folder.contextValue}"`
    );
  });

  it('AC4-effective: version + update text + enabled status all render in description; effective-based summary counts', () => {
    const instA = makeInstalledById('a-plugin', '1.0', `${CACHE}/mk/a-plugin/1.0`, 'project');
    const instB = makeInstalledById('b-plugin', '2.0', `${CACHE}/mk/b-plugin/2.0`, 'local');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['a-plugin', instA], ['b-plugin', instB]]),
      outdated: new Set(['a-plugin']),  // 1 update
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map([['b-plugin@mk', false]]),  // b disabled locally
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const aFolder = getWdPluginFolders(nodes).find(f => f.pluginName === 'a-plugin')!;
    const bFolder = getWdPluginFolders(nodes).find(f => f.pluginName === 'b-plugin')!;

    // a-plugin: version + update available + enabled
    assert.ok(aFolder.description && aFolder.description.includes('1.0'), `a description should include version: "${aFolder.description}"`);
    assert.ok(aFolder.description && aFolder.description.includes('update available'), `a description should include "update available": "${aFolder.description}"`);
    assert.ok(aFolder.description && aFolder.description.endsWith(' · enabled'), `a description should end with " · enabled": "${aFolder.description}"`);

    // b-plugin: version + disabled
    assert.ok(bFolder.description && bFolder.description.includes('2.0'), `b description should include version: "${bFolder.description}"`);
    assert.ok(bFolder.description && bFolder.description.endsWith(' · disabled'), `b description should end with " · disabled": "${bFolder.description}"`);

    // Summary counts: 1/2 enabled (a=enabled, b=disabled)
    const pluginsRoot = getProjectPluginsFolder(nodes)!;
    const mkFolder = (pluginsRoot.children as ContainerNodeDescriptor[]).find(c => c.label === 'mk')!;
    assert.ok(mkFolder.description && mkFolder.description.includes('1/2 enabled'),
      `marketplace description should include "1/2 enabled", got: "${mkFolder.description}"`);
    assert.ok(pluginsRoot.description && pluginsRoot.description.includes('1/2 enabled'),
      `root description should include "1/2 enabled", got: "${pluginsRoot.description}"`);
  });

  // ---------------------------------------------------------------------------
  // AC-compat: old tests rewritten without projectPlugins
  // ---------------------------------------------------------------------------

  it('AC-compat-version: version appears in plugin folder description; dirPath = installPath', () => {
    const installPath = `${CACHE}/mk/versioned/1.2.3`;
    const inst = makeInstalledById('versioned', '1.2.3', installPath, 'project');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['versioned', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'versioned')!;
    assert.ok(folder, 'expected versioned folder');
    assert.ok(folder.description && folder.description.includes('1.2.3'),
      `description should include version, got: "${folder.description}"`);
    assert.strictEqual(folder.dirPath, installPath, 'dirPath should equal installPath');
  });

  it('AC-compat-update: update available text and flag on plugin folder when in outdated set', () => {
    const inst = makeInstalledById('old-plugin', '1.0', `${CACHE}/mk/old-plugin/1.0`, 'project');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['old-plugin', inst]]),
      outdated: new Set(['old-plugin']),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getWdPluginFolders(nodes).find(f => f.pluginName === 'old-plugin')!;
    assert.ok(folder, 'expected old-plugin folder');
    assert.ok(folder.description && folder.description.includes('update available'),
      `description should include "update available", got: "${folder.description}"`);
    assert.strictEqual(folder.outdated, true, 'outdated flag should be true');
  });

  // ---------------------------------------------------------------------------
  // AC5: empty state (claudeDir set, no project/local installs) + no-dir guard
  // ---------------------------------------------------------------------------

  it('AC5a: claudeDir set + no project/local installs -> folder present with (no plugins installed), no children', () => {
    const userInst = makeInstalledById('user-only', '1.0', `${CACHE}/mk/user-only/1.0`, 'user');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['user-only', userInst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getProjectPluginsFolder(nodes)!;
    assert.ok(folder, 'expected a plugins folder when claudeDir is set, even with no project/local installs');
    assert.strictEqual(folder.contextValue, 'assetProjectPluginsRoot');
    assert.strictEqual(folder.description, '(no plugins installed)',
      `expected "(no plugins installed)", got: "${folder.description}"`);
    assert.strictEqual(folder.children.length, 0, 'no children when no project/local installs');
    assert.strictEqual(folder.dirPath, PROJ_CLAUDE_DIR);
  });

  it('AC5b: no claudeDir + no project/local installs -> no folder', () => {
    const userInst = makeInstalledById('user-only', '1.0', `${CACHE}/mk/user-only/1.0`, 'user');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['user-only', userInst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: undefined
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getProjectPluginsFolder(nodes);
    assert.strictEqual(folder, undefined, 'no folder when no claudeDir and no project/local installs');
  });

  it('AC5c: no installs at all + claudeDir set -> empty folder', () => {
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getProjectPluginsFolder(nodes)!;
    assert.ok(folder, 'expected a plugins folder');
    assert.strictEqual(folder.description, '(no plugins installed)');
    assert.strictEqual(folder.children.length, 0);
  });

  it('AC5d: no installs + no claudeDir -> no folder', () => {
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: undefined
    };

    const nodes = buildTreeNodes([], meta);
    const folder = getProjectPluginsFolder(nodes);
    assert.strictEqual(folder, undefined, 'no folder when completely empty');
  });

  // ---------------------------------------------------------------------------
  // AC6: folder is LAST WD child; WD container emitted even when it is the only content
  // ---------------------------------------------------------------------------

  it('AC6a: plugins folder is LAST child of Working Directory (after sub-projects)', () => {
    const inst = makeInstalledById('foo', '1.0', `${CACHE}/mk/foo/1.0`, 'project');
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['foo', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes(assets, meta);
    const wd = getWorkingDir(nodes)!;
    assert.ok(wd, 'expected Working Directory container');
    const last = wd.children[wd.children.length - 1];
    assert.strictEqual(last.kind, NodeKind.Container, 'last child should be Container');
    assert.strictEqual((last as ContainerNodeDescriptor).containerKind, 'plugins', 'last child should be plugins folder');
  });

  it('AC6b: WD container emitted when plugins folder (project install) is the only WD content', () => {
    const inst = makeInstalledById('foo', '1.0', `${CACHE}/mk/foo/1.0`, 'project');
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['foo', inst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const wd = getWorkingDir(nodes);
    assert.ok(wd, 'Working Directory container must appear when only a plugins folder is present');
  });

  it('AC6c: WD container emitted when only an empty-state plugins folder (claudeDir set, no installs)', () => {
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);
    const wd = getWorkingDir(nodes);
    assert.ok(wd, 'WD must appear when claudeDir is set even if no installs');
    // projectClaudeDir now also injects empty Skill/Subagent/Command groups, so children
    // are: Skills group, Agents group, Commands group, plugins folder (4 total).
    assert.ok(wd!.children.length >= 1, 'WD should have at least the plugins folder as a child');
    const pluginsChild = wd!.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins'
    );
    assert.ok(pluginsChild, 'WD should contain a plugins folder child');
  });

  // ---------------------------------------------------------------------------
  // Regression: no pluginMeta -> no WD plugins folder
  // ---------------------------------------------------------------------------

  it('AC-REG-1: no pluginMeta at all -> no WD plugins folder', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const folder = getProjectPluginsFolder(nodes);
    assert.strictEqual(folder, undefined, 'no project plugins folder when no pluginMeta');
  });

  // ---------------------------------------------------------------------------
  // Global Plugins folder unchanged when project/local installs present
  // ---------------------------------------------------------------------------

  it('AC-REG-2: Global Plugins folder unchanged when project/local installs present', () => {
    const userInst = makeInstalledById('user-plugin', '1.0', `${CACHE}/mk/user-plugin/1.0`, 'user');
    const projInst = makeInstalledById('proj-plugin', '2.0', `${CACHE}/mk/proj-plugin/2.0`, 'project');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['user-plugin', userInst], ['proj-plugin', projInst]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR
    };

    const nodes = buildTreeNodes([], meta);

    // Global still shows user-plugin
    const globalFolders = getPluginFolders(nodes);
    assert.ok(globalFolders.some(f => f.pluginName === 'user-plugin'), 'user-plugin should appear in Global');
    assert.ok(!globalFolders.some(f => f.pluginName === 'proj-plugin'), 'proj-plugin must NOT appear in Global');

    // WD shows proj-plugin
    const wdFolders = getWdPluginFolders(nodes);
    assert.ok(wdFolders.some(f => f.pluginName === 'proj-plugin'), 'proj-plugin should appear in WD');
    assert.ok(!wdFolders.some(f => f.pluginName === 'user-plugin'), 'user-plugin must NOT appear in WD');
  });

  it('AC-REG-3: stale enablement entry with no matching install produces no WD node', () => {
    // WD membership is driven solely by installedPlugins (scope project|local).
    // A stale teamEnabled/localEnabled entry with no matching install must produce no folder.
    const meta: PluginMetadataOptions = {
      installedPlugins: new Map(),
      outdated: new Set(),
      projectTeamEnabled: new Map([['ghost@claude-plugins-official', true]]),
      projectLocalEnabled: new Map(),
      projectClaudeDir: PROJ_CLAUDE_DIR,
      marketplaces: new Map()
    };

    const nodes = buildTreeNodes([], meta);
    const wdFolders = getWdPluginFolders(nodes);
    assert.strictEqual(wdFolders.length, 0, `expected 0 WD plugin folders (no install records), got: ${wdFolders.map(f => f.pluginName).join(', ')}`);

    const pluginsFolder = getProjectPluginsFolder(nodes)!;
    assert.ok(pluginsFolder, 'plugins folder should still appear because claudeDir is set');
    assert.strictEqual(pluginsFolder.description, '(no plugins installed)');
    assert.strictEqual(pluginsFolder.children.length, 0);
  });

  // ---------------------------------------------------------------------------
  // AC4: WD project-plugins folder cross-references a project-scoped install (scope filtering test)
  // ---------------------------------------------------------------------------

  it('AC-scope-filter: WD project plugin has correct version and dirPath from the install record', () => {
    const projInstallPath = `${CACHE}/mk/proj-plugin/2.0.0`;
    const projInstall = makeInstalledById('proj-plugin', '2.0.0', projInstallPath, 'project');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['proj-plugin', projInstall]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: '/Users/braden/Projects/.claude'
    };

    const nodes = buildTreeNodes([], meta);
    const wd = getWorkingDir(nodes)!;
    assert.ok(wd, 'expected Working Directory container');

    let projFolder: PluginFolderNodeDescriptor | undefined;
    const pluginsFolder = wd.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins'
    ) as ContainerNodeDescriptor | undefined;
    assert.ok(pluginsFolder, 'expected plugins folder under WD');
    for (const child of pluginsFolder!.children) {
      if (child.kind === NodeKind.Container && (child as ContainerNodeDescriptor).containerKind === 'marketplace') {
        projFolder = (child as ContainerNodeDescriptor).children.find(
          f => f.kind === NodeKind.PluginFolder && (f as PluginFolderNodeDescriptor).pluginName === 'proj-plugin'
        ) as PluginFolderNodeDescriptor | undefined;
        if (projFolder) break;
      }
    }
    assert.ok(projFolder, 'expected proj-plugin folder under WD plugins marketplace');
    assert.ok(projFolder!.description && projFolder!.description.includes('2.0.0'),
      `WD project plugin description should include "2.0.0", got: "${projFolder!.description}"`);
    assert.strictEqual(projFolder!.dirPath, projInstallPath, 'WD project plugin dirPath should use the install path');
  });
});

// ---------------------------------------------------------------------------
// AC2 / AC3 / AC4: scope filtering for Global plugins folder
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- scope filtering (Global shows only user-scope installs)', () => {
  const CACHE = '/Users/braden/.claude/plugins/cache';
  const MK = 'mko';

  function makeInstalledInfoScoped(
    name: string,
    installPath: string,
    version: string | null,
    scope: 'user' | 'project' | 'local'
  ): InstalledPluginInfo {
    return { name, id: `${name}@${MK}`, marketplace: MK, version, installPath, lastUpdated: '2025-06-01T00:00:00Z', scope };
  }

  function makeMarket(name: string): MarketplaceInfo {
    return { name, installLocation: `${CACHE}/${name}`, lastUpdated: '' };
  }

  it('AC2: Global marketplace folders contain only user-scope plugin folders; project/local ids absent', () => {
    const userInstall = makeInstalledInfoScoped('user-plugin', `${CACHE}/${MK}/user-plugin/1.0.0`, '1.0.0', 'user');
    const projInstall = makeInstalledInfoScoped('proj-plugin', `${CACHE}/${MK}/proj-plugin/1.0.0`, '1.0.0', 'project');
    const localInstall = makeInstalledInfoScoped('local-plugin', `${CACHE}/${MK}/local-plugin/1.0.0`, '1.0.0', 'local');
    const marketplaces = new Map([[MK, makeMarket(MK)]]);

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([
        ['user-plugin', userInstall],
        ['proj-plugin', projInstall],
        ['local-plugin', localInstall]
      ]),
      outdated: new Set(),
      marketplaces
    };

    const nodes = buildTreeNodes([], meta);
    const folders = getPluginFolders(nodes);
    const names = folders.map(f => f.pluginName);

    assert.ok(names.includes('user-plugin'), 'user-scope plugin must appear in Global');
    assert.ok(!names.includes('proj-plugin'), 'project-scope plugin must NOT appear in Global');
    assert.ok(!names.includes('local-plugin'), 'local-scope plugin must NOT appear in Global');
  });

  it('AC2b: a marketplace with ONLY project/local installs shows no plugin folders (marketplace may still appear from knownMarketplaces)', () => {
    const projInstall = makeInstalledInfoScoped('proj-only', `${CACHE}/${MK}/proj-only/1.0.0`, '1.0.0', 'project');
    const marketplaces = new Map([[MK, makeMarket(MK)]]);

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['proj-only', projInstall]]),
      outdated: new Set(),
      marketplaces
    };

    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes);
    // marketplace still shows (it is in knownMarketplaces) but has no plugin children
    assert.ok(plugins, 'Plugins container should still appear from knownMarketplaces');
    const mkFolder = (plugins!.children as ContainerNodeDescriptor[]).find(c => c.label === MK);
    assert.ok(mkFolder, 'marketplace folder should still show from knownMarketplaces');
    assert.strictEqual(mkFolder!.children.length, 0, 'no plugin children for project-only marketplace');
  });

  it('AC2c: no user installs AND no knownMarketplaces -> NO Global plugins folder', () => {
    const projInstall = makeInstalledInfoScoped('proj-only', `${CACHE}/${MK}/proj-only/1.0.0`, '1.0.0', 'project');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['proj-only', projInstall]]),
      outdated: new Set()
      // no marketplaces
    };

    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes);
    assert.strictEqual(plugins, undefined, 'No Global plugins folder when only project-scope installs and no knownMarketplaces');
  });

  it('AC3: Global root/marketplace enabled counts and updates count reflect user installs only', () => {
    const userInstall = makeInstalledInfoScoped('user-plugin', `${CACHE}/${MK}/user-plugin/1.0.0`, '1.0.0', 'user');
    const projInstall = makeInstalledInfoScoped('proj-plugin', `${CACHE}/${MK}/proj-plugin/2.0.0`, '2.0.0', 'project');
    const enabledMap = new Map<string, boolean>([
      ['user-plugin@mko', true],
      ['proj-plugin@mko', true]  // project one is also "enabled" in the map
    ]);
    // proj-plugin is in outdated set (should NOT inflate global count)
    const outdated = new Set<string>(['proj-plugin']);
    const marketplaces = new Map([[MK, makeMarket(MK)]]);

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([
        ['user-plugin', userInstall],
        ['proj-plugin', projInstall]
      ]),
      outdated,
      enabled: enabledMap,
      marketplaces
    };

    const nodes = buildTreeNodes([], meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'expected Plugins container');

    // Root description: only user-plugin counts -> "1/1 enabled", NOT "2/2" or "1/2"
    assert.ok(
      plugins.description && plugins.description.includes('1/1 enabled'),
      `root description should say "1/1 enabled", got: "${plugins.description}"`
    );

    // Root updates: proj-plugin (project-scope) in outdated set must NOT appear in global count
    assert.ok(
      !plugins.description || !plugins.description.includes('update'),
      `root description must NOT show updates from project-scope plugin, got: "${plugins.description}"`
    );

    // Marketplace description also only counts user installs
    const mkFolder = (plugins.children as ContainerNodeDescriptor[]).find(c => c.label === MK);
    assert.ok(mkFolder, 'expected marketplace folder');
    assert.ok(
      mkFolder!.description && mkFolder!.description.includes('1/1 enabled'),
      `marketplace description should say "1/1 enabled", got: "${mkFolder!.description}"`
    );
    assert.ok(
      !mkFolder!.description || !mkFolder!.description.includes('update'),
      `marketplace description must NOT show updates from project-scope plugin, got: "${mkFolder!.description}"`
    );
  });

  it('AC4: WD project-plugins folder cross-references a project-scoped install by id for version/dirPath', () => {
    const projInstallPath = `${CACHE}/${MK}/proj-plugin/2.0.0`;
    const projInstall = makeInstalledInfoScoped('proj-plugin', projInstallPath, '2.0.0', 'project');

    const meta: PluginMetadataOptions = {
      installedPlugins: new Map([['proj-plugin', projInstall]]),
      outdated: new Set(),
      projectTeamEnabled: new Map(),
      projectLocalEnabled: new Map(),
      projectClaudeDir: '/Users/braden/Projects/.claude'
    };

    const nodes = buildTreeNodes([], meta);

    // WD project plugins folder should have the version and installPath from the project-scoped install
    const wd = getWorkingDir(nodes)!;
    assert.ok(wd, 'expected Working Directory container');
    const pluginsFolder = wd.children.find(
      c => c.kind === NodeKind.Container && (c as ContainerNodeDescriptor).containerKind === 'plugins'
    ) as ContainerNodeDescriptor | undefined;
    assert.ok(pluginsFolder, 'expected plugins folder under WD');

    // Find proj-plugin inside marketplace containers
    let projFolder: PluginFolderNodeDescriptor | undefined;
    for (const child of pluginsFolder!.children) {
      if (child.kind === NodeKind.Container && (child as ContainerNodeDescriptor).containerKind === 'marketplace') {
        projFolder = (child as ContainerNodeDescriptor).children.find(
          f => f.kind === NodeKind.PluginFolder && (f as PluginFolderNodeDescriptor).pluginName === 'proj-plugin'
        ) as PluginFolderNodeDescriptor | undefined;
        if (projFolder) break;
      }
    }
    assert.ok(projFolder, 'expected proj-plugin folder under WD plugins marketplace');
    assert.ok(projFolder!.description && projFolder!.description.includes('2.0.0'),
      `WD project plugin description should include "2.0.0", got: "${projFolder!.description}"`);
    assert.strictEqual(projFolder!.dirPath, projInstallPath, 'WD project plugin dirPath should use the install path');
  });
});

// ---------------------------------------------------------------------------
// AC7: Global always-visible empty Skill/Subagent/Command groups
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- AC7: empty global type groups when globalClaudeDir is set', () => {
  const globalClaudeDir = '/home/user/.claude';

  it('Global container renders even with zero global assets when globalClaudeDir is set', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
    assert.ok(global, 'Global container should render when globalClaudeDir is set even with no assets');
  });

  it('Global children include Skill group (empty, createTargetDir set)', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const skillGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Skill) as GroupNodeDescriptor | undefined;
    assert.ok(skillGroup, 'Skill group should be present in Global');
    assert.strictEqual(skillGroup!.children.length, 0, 'Skill group should have no children');
    assert.strictEqual(skillGroup!.createTargetDir, path.join(globalClaudeDir, 'skills'), 'createTargetDir should be <globalClaudeDir>/skills');
  });

  it('Global children include Subagent group (empty, createTargetDir set)', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const agentGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Subagent) as GroupNodeDescriptor | undefined;
    assert.ok(agentGroup, 'Subagent group should be present in Global');
    assert.strictEqual(agentGroup!.createTargetDir, path.join(globalClaudeDir, 'agents'), 'createTargetDir should be <globalClaudeDir>/agents');
  });

  it('An empty Command group IS injected into Global with createTargetDir (create/drop target)', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const cmdGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Command) as GroupNodeDescriptor | undefined;
    assert.ok(cmdGroup, 'empty commands folder should be shown as a create/drop target');
    assert.strictEqual(cmdGroup!.createTargetDir, path.join(globalClaudeDir, 'commands'));
  });

  it('No Memory group is injected into Global when no memory assets exist', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const memoryGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Memory);
    assert.strictEqual(memoryGroup, undefined, 'No empty Memory group should be injected');
  });

  it('Canonical order in empty Global groups: Skill, Subagent, Command, Workflow', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const groups = global.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    assert.deepStrictEqual(
      groups.map(g => g.assetType),
      [AssetType.Skill, AssetType.Subagent, AssetType.Command, AssetType.Workflow]
    );
  });

  it('Global children include Workflow group (empty, read-only, no createTargetDir)', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const wfGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Workflow) as GroupNodeDescriptor | undefined;
    assert.ok(wfGroup, 'Workflow group should be present in Global even when empty');
    assert.strictEqual(wfGroup!.children.length, 0, 'Workflow group should have no children');
    assert.strictEqual(wfGroup!.createTargetDir, undefined, 'Workflow group is read-only: no createTargetDir');
  });

  it('Global does NOT render without globalClaudeDir when no global assets', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set() } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
    assert.strictEqual(global, undefined, 'Global should not render without globalClaudeDir and no assets');
  });
});

// ---------------------------------------------------------------------------
// AC8: Working Directory always-visible empty groups when projectClaudeDir is set
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- AC8: empty WD type groups when projectClaudeDir is set', () => {
  const projectClaudeDir = '/Users/braden/Projects/MyApp/.claude';

  it('Working Directory container renders with empty groups when projectClaudeDir is set and no WD assets', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), projectClaudeDir } as PluginMetadataOptions);
    const wd = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'working-directory');
    assert.ok(wd, 'Working Directory container should render when projectClaudeDir is set');
  });

  it('WD flat root contains Skill group with createTargetDir = <projectClaudeDir>/skills', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), projectClaudeDir } as PluginMetadataOptions);
    const wd = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'working-directory')!;
    const skillGroup = wd.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Skill) as GroupNodeDescriptor | undefined;
    assert.ok(skillGroup, 'Skill group should appear in WD flat root area');
    assert.strictEqual(skillGroup!.createTargetDir, path.join(projectClaudeDir, 'skills'));
  });

  it('WD flat root contains Subagent group with createTargetDir = <projectClaudeDir>/agents', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), projectClaudeDir } as PluginMetadataOptions);
    const wd = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'working-directory')!;
    const agentGroup = wd.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Subagent) as GroupNodeDescriptor | undefined;
    assert.ok(agentGroup, 'Subagent group should appear in WD flat root area');
    assert.strictEqual(agentGroup!.createTargetDir, path.join(projectClaudeDir, 'agents'));
  });

  it('WD flat root contains Command group with createTargetDir = <projectClaudeDir>/commands', () => {
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), projectClaudeDir } as PluginMetadataOptions);
    const wd = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'working-directory')!;
    const cmdGroup = wd.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Command) as GroupNodeDescriptor | undefined;
    assert.ok(cmdGroup, 'empty commands folder should appear in WD as a create/drop target');
    assert.strictEqual(cmdGroup!.createTargetDir, path.join(projectClaudeDir, 'commands'));
  });
});

// ---------------------------------------------------------------------------
// AC9: Non-empty groups carry createTargetDir
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- AC9: non-empty groups carry createTargetDir', () => {
  it('Non-empty Command group has createTargetDir set to commands segment dir, dirPath undefined', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'foo', '/home/user/.claude/commands/foo.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets, { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir: '/home/user/.claude' } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const cmdGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Command) as GroupNodeDescriptor;
    assert.ok(cmdGroup, 'Command group should exist');
    assert.strictEqual(cmdGroup.createTargetDir, '/home/user/.claude/commands', 'createTargetDir should be the commands segment dir');
    assert.strictEqual(cmdGroup.dirPath, undefined, 'Command group dirPath should remain undefined (static children)');
    assert.ok(cmdGroup.children.length > 0, 'Command group should have children');
  });

  it('Non-empty Skill group keeps dirPath and also has createTargetDir equal to dirPath', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'bar', '/home/user/.claude/skills/bar/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets, { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir: '/home/user/.claude' } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const skillGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Skill) as GroupNodeDescriptor;
    assert.ok(skillGroup, 'Skill group should exist');
    assert.ok(skillGroup.dirPath, 'Skill group should have dirPath set');
    assert.strictEqual(skillGroup.createTargetDir, skillGroup.dirPath, 'createTargetDir should equal dirPath for Skill');
  });

  it('Non-empty Subagent group keeps dirPath and also has createTargetDir equal to dirPath', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Subagent, 'my-agent', '/home/user/.claude/agents/my-agent.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets, { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir: '/home/user/.claude' } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const agentGroup = global.children.find(c => c.kind === NodeKind.Group && (c as GroupNodeDescriptor).assetType === AssetType.Subagent) as GroupNodeDescriptor;
    assert.ok(agentGroup, 'Subagent group should exist');
    assert.ok(agentGroup.dirPath, 'Subagent group should have dirPath set');
    assert.strictEqual(agentGroup.createTargetDir, agentGroup.dirPath, 'createTargetDir should equal dirPath for Subagent');
  });
});

// ---------------------------------------------------------------------------
// AC10: GroupNodeDescriptor carries createTargetDir (descriptor-level coverage)
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- AC10: GroupNodeDescriptor.createTargetDir present on descriptor', () => {
  it('descriptor createTargetDir is present on the creatable injected empty global groups', () => {
    const globalClaudeDir = '/home/user/.claude';
    const nodes = buildTreeNodes([], { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const groups = global.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    // Skill/Subagent/Command are creatable; Workflow is read-only and intentionally has none.
    for (const g of groups.filter(g => g.assetType !== AssetType.Workflow)) {
      assert.ok(g.createTargetDir !== undefined, `Group ${g.assetType} should have createTargetDir on descriptor`);
    }
    const wf = groups.find(g => g.assetType === AssetType.Workflow)!;
    assert.strictEqual(wf.createTargetDir, undefined, 'Workflow group should be read-only (no createTargetDir)');
  });
});

// ---------------------------------------------------------------------------
// AC11: Exactly one group per creatable type, no duplicates
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- AC11: exactly one group per creatable type, no duplicates', () => {
  it('Global container has exactly three creatable-type groups and exactly one of each when Command has an asset while Skill and Subagent are injected empty', () => {
    const globalClaudeDir = '/home/user/.claude';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'foo', '/home/user/.claude/commands/foo.md', AssetScope.Global, globalClaudeDir)
    ];
    const nodes = buildTreeNodes(assets, { installedPlugins: new Map(), outdated: new Set(), globalClaudeDir } as PluginMetadataOptions);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    assert.ok(global, 'Global container must exist');

    const groups = global.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
    const creatableTypes = [AssetType.Skill, AssetType.Subagent, AssetType.Command];

    // Total count of creatable-type groups must be exactly three
    const creatableGroups = groups.filter(g => creatableTypes.includes(g.assetType));
    assert.strictEqual(creatableGroups.length, 3, 'Global container must have exactly three creatable-type groups (Skill, Subagent, Command)');

    // Exactly one group per creatable type
    for (const type of creatableTypes) {
      const count = groups.filter(g => g.assetType === type).length;
      assert.strictEqual(count, 1, `Expected exactly one ${type} group, got ${count}`);
    }

    // Memory must not be injected as an empty group
    const memoryGroups = groups.filter(g => g.assetType === AssetType.Memory);
    assert.strictEqual(memoryGroups.length, 0, 'Memory group must not be injected when no Memory assets exist');
  });
});
