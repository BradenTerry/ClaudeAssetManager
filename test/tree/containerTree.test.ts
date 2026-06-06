import * as assert from 'assert';
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
import { InstalledPluginInfo } from '../../src/core/pluginMetadata';

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

  it('Global type-group children are asset nodes sorted alpha by name', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'zebra-skill', '/home/user/.claude/skills/zebra-skill/SKILL.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Skill, 'alpha-skill', '/home/user/.claude/skills/alpha-skill/SKILL.md', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const globalContainer = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const skillGroup = globalContainer.children.find(c => (c as GroupNodeDescriptor).assetType === AssetType.Skill) as GroupNodeDescriptor;
    const names = skillGroup.children.map(c => (c as AssetNodeDescriptor).label);
    assert.deepStrictEqual(names, ['alpha-skill', 'zebra-skill'], 'assets should be sorted alpha by name');
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
    const filePath = '/home/user/.claude/plugins/cache/mk/myplugin/1.0/skills/p-skill/SKILL.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'p-skill', filePath, AssetScope.Plugin, '/home/user/.claude/plugins')
    ];
    const nodes = buildTreeNodes(assets);
    const pluginsContainer = getPluginsFromGlobal(nodes)!;
    const pluginFolder = pluginsContainer.children[0] as PluginFolderNodeDescriptor;
    const skillGroup = pluginFolder.children[0] as GroupNodeDescriptor;
    const assetNode = skillGroup.children[0] as AssetNodeDescriptor;
    assert.strictEqual(assetNode.kind, NodeKind.Asset);
    assert.ok(assetNode.contextValue.includes('-md-'), 'plugin asset should have -md- contextValue');
    assert.strictEqual(assetNode.commandId, 'claudeAssets.openPreview');
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
    const filePath = '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'proj-skill', filePath, AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const projContainer = getProjects(nodes)[0];
    const skillGroup = projContainer.children[0] as GroupNodeDescriptor;
    const assetNode = skillGroup.children[0] as AssetNodeDescriptor;
    assert.ok(assetNode.contextValue.includes('-md-'), 'skill asset should have -md- contextValue');
    assert.strictEqual(assetNode.commandId, 'claudeAssets.openPreview');
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

  it('Registered-scope assets grouped by derived project name', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'reg-skill', '/Users/braden/Projects/foo/skills/bar/SKILL.md', AssetScope.Registered, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const projContainer = findProject(nodes, 'foo');
    assert.ok(projContainer, 'registered asset should be grouped under project "foo"');
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

function makeInstalledInfo(name: string, installPath: string, version = 'unknown', lastUpdated = '2025-06-01T00:00:00Z'): InstalledPluginInfo {
  return { name, version, installPath, lastUpdated };
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

// ---------------------------------------------------------------------------
// Plugin folder -- direct children of Plugins container (no Installed/Available split)
// ---------------------------------------------------------------------------

describe('buildTreeNodes -- Plugins container has direct plugin folder children', () => {
  it('AC-TREE-NEW1: Plugins container children are PluginFolder nodes directly (no sub-sections)', () => {
    const assets = [makePluginAsset('analyzer', CACHE_ASSET_SC)];
    const meta = makePluginMeta({
      'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC)
    });
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;
    assert.ok(plugins, 'expected Plugins container');

    // Children must be PluginFolder nodes, not Container nodes
    assert.ok(plugins.children.length > 0, 'expected at least one child');
    const firstChild = plugins.children[0];
    assert.strictEqual(firstChild.kind, NodeKind.PluginFolder, 'Plugins children should be PluginFolder nodes directly (no Installed/Available sub-sections)');
  });

  it('AC-TREE-NEW2: installed plugin folder appears directly under Plugins, sorted alpha', () => {
    const installPathFD = '/Users/braden/.claude/plugins/cache/claude-plugins-official/frontend-design/1.0.0';
    const assetFD = `${installPathFD}/skills/frontend-design/SKILL.md`;
    const assets = [
      makePluginAsset('analyzer', CACHE_ASSET_SC),
      { type: AssetType.Skill, name: 'frontend-design', filePath: assetFD, scope: AssetScope.Plugin, description: undefined, rootPath: PLUGINS_CACHE_ROOT }
    ];
    const meta = makePluginMeta({
      'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC),
      'frontend-design': makeInstalledInfo('frontend-design', installPathFD, '1.0.0')
    });
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;

    const folders = plugins.children as PluginFolderNodeDescriptor[];
    assert.strictEqual(folders.length, 2, 'expected 2 plugin folders');
    // sorted alpha: frontend-design before skill-creator
    assert.strictEqual(folders[0].pluginName, 'frontend-design');
    assert.strictEqual(folders[1].pluginName, 'skill-creator');
  });

  it('AC-TREE-NEW3: installed plugin folder has version description', () => {
    const assets = [makePluginAsset('analyzer', CACHE_ASSET_SC)];
    const meta = makePluginMeta({
      'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC, 'unknown')
    });
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;

    const scFolder = (plugins.children as PluginFolderNodeDescriptor[]).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(scFolder, 'skill-creator folder should exist');
    assert.ok(scFolder.description, 'installed plugin folder should have a description');
    assert.ok(
      scFolder.description!.includes('unknown'),
      `description should include version. Got: "${scFolder.description}"`
    );
  });

  it('AC-TREE-NEW3b: installed plugin with version 1.0.0 shows that version in description', () => {
    const installPath = '/Users/braden/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0';
    const assetPath = `${installPath}/skills/claude-automation-recommender/SKILL.md`;
    const assets = [{ type: AssetType.Skill, name: 'claude-automation-recommender', filePath: assetPath, scope: AssetScope.Plugin, description: undefined, rootPath: PLUGINS_CACHE_ROOT }];
    const meta = makePluginMeta({
      'claude-code-setup': makeInstalledInfo('claude-code-setup', installPath, '1.0.0')
    });
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;

    const folder = (plugins.children as PluginFolderNodeDescriptor[]).find(f => f.pluginName === 'claude-code-setup')!;
    assert.ok(folder, 'claude-code-setup folder should exist');
    assert.ok(folder.description!.includes('1.0.0'), `expected description to include "1.0.0", got: "${folder.description}"`);
  });

  it('AC-TREE-NEW4: outdated plugin description includes "update available" and outdated flag is true', () => {
    const assets = [makePluginAsset('analyzer', CACHE_ASSET_SC)];
    const meta = makePluginMeta(
      { 'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC, 'unknown') },
      ['skill-creator']
    );
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;

    const scFolder = (plugins.children as PluginFolderNodeDescriptor[]).find(f => f.pluginName === 'skill-creator')!;
    assert.ok(
      scFolder.description!.includes('update available'),
      `description should include "update available". Got: "${scFolder.description}"`
    );
    assert.strictEqual(scFolder.outdated, true, 'PluginFolderNodeDescriptor.outdated should be true');
  });

  it('AC-TREE-NEW5: no duplicate assets -- cache-only scanning means each asset appears once', () => {
    // Cache-only: scanner only yields assets from plugins/cache, no marketplace copies
    const assets = [
      makePluginAsset('analyzer', CACHE_ASSET_SC)   // single cache copy
    ];
    const meta = makePluginMeta({
      'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC)
    });
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;

    const scFolder = (plugins.children as PluginFolderNodeDescriptor[]).find(f => f.pluginName === 'skill-creator')!;
    const allAssetNodes: AssetNodeDescriptor[] = [];
    for (const group of scFolder.children as GroupNodeDescriptor[]) {
      for (const asset of group.children as AssetNodeDescriptor[]) {
        allAssetNodes.push(asset);
      }
    }
    const analyzerNodes = allAssetNodes.filter(a => a.label === 'analyzer');
    assert.strictEqual(analyzerNodes.length, 1, 'each asset should appear exactly once');
  });

  it('AC-TREE-NEW6: plugin with no metadata entry still shows in Plugins with no description', () => {
    // Cache asset scanned but no pluginMeta provided: flat behavior, no description
    const assets = [makePluginAsset('p-skill', '/home/user/.claude/plugins/cache/mk/plugin-a/1.0/skills/p-skill/SKILL.md')];
    const nodes = buildTreeNodes(assets);
    const plugins = getPluginsContainer(nodes)!;

    const folder = (plugins.children as PluginFolderNodeDescriptor[])[0];
    assert.strictEqual(folder.kind, NodeKind.PluginFolder, 'should be a PluginFolder');
    assert.strictEqual(folder.pluginName, 'plugin-a');
    assert.strictEqual(folder.description, undefined, 'no metadata -> no description');
  });

  it('AC-TREE-NEW7: no "Installed" or "Available" Container nodes ever appear under Plugins', () => {
    const assets = [makePluginAsset('analyzer', CACHE_ASSET_SC)];
    const meta = makePluginMeta({
      'skill-creator': makeInstalledInfo('skill-creator', INSTALL_PATH_SC)
    });
    const nodes = buildTreeNodes(assets, meta);
    const plugins = getPluginsContainer(nodes)!;

    const subContainers = (plugins.children as ContainerNodeDescriptor[]).filter(
      c => c.kind === NodeKind.Container
    );
    assert.strictEqual(subContainers.length, 0, 'Plugins container should have no sub-Container nodes (no Installed/Available sections)');
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

  it('AC-WD5: Working Directory label is "Working Directory"', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'proj-skill', '/Users/braden/Projects/MyApp/.claude/skills/proj-skill/SKILL.md', AssetScope.Project, '/Users/braden/Projects')
    ];
    const nodes = buildTreeNodes(assets);
    const wd = getWorkingDir(nodes);
    assert.ok(wd, 'expected Working Directory container');
    assert.strictEqual(wd!.label, 'Working Directory');
  });

  it('AC-WD6: root-level assets (the working dir own .claude) render flat at the WD root, not in a self-named folder', () => {
    const assets: ClaudeAsset[] = [
      // sub-project beneath the registered root
      makeAsset(AssetType.Skill, 'a-skill', '/Users/braden/Projects/Alpha/.claude/skills/a-skill/SKILL.md', AssetScope.Registered, '/Users/braden/Projects'),
      // the working dir's OWN .claude config (directly under the registered root)
      makeAsset(AssetType.Config, 'settings.local.json', '/Users/braden/Projects/.claude/settings.local.json', AssetScope.Registered, '/Users/braden/Projects')
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
    assert.strictEqual(worktreesFolder.label, 'Worktrees');
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
    const mainPath = '/Users/braden/Projects/Workouts/.claude/skills/foo/SKILL.md';
    const wtPath = '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', mainPath, AssetScope.Project, '/Users/braden/Projects'),
      makeAsset(AssetType.Skill, 'foo', wtPath, AssetScope.Project, '/Users/braden/Projects')
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
    const skillPath = '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/skills/foo/SKILL.md';
    const configPath = '/Users/braden/Projects/Workouts/.claude/worktrees/wt1/.claude/settings.json';
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'foo', skillPath, AssetScope.Project, '/Users/braden/Projects'),
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
    assert.strictEqual(skillNode!.commandId, 'claudeAssets.openPreview', 'skill should use openPreview');
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

  it('AC-FLAT: flat leaf nodes have correct commandId and contextValue (CLAUDE.md -> openPreview, Config -> openFile)', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', '/home/user/.claude/CLAUDE.md', AssetScope.Global, '/home/user/.claude'),
      makeAsset(AssetType.Config, 'settings.json', '/home/user/.claude/settings.json', AssetScope.Global, '/home/user/.claude')
    ];
    const nodes = buildTreeNodes(assets);
    const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global')!;
    const leaves = global.children as AssetNodeDescriptor[];

    const claudeMd = leaves.find(a => a.asset.type === AssetType.ClaudeMd)!;
    assert.ok(claudeMd, 'expected CLAUDE.md leaf');
    assert.strictEqual(claudeMd.commandId, 'claudeAssets.openPreview', 'CLAUDE.md should use openPreview');
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
