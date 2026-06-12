import * as assert from 'assert';
import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset } from '../../src/core/types';
import {
  buildTreeNodes,
  NodeKind,
  ContainerNodeDescriptor,
  PluginFolderNodeDescriptor,
  GroupNodeDescriptor,
  AssetNodeDescriptor
} from '../../src/tree/nodeDescriptors';

function makeAsset(
  type: AssetType,
  name: string,
  filePath: string,
  scope: AssetScope = AssetScope.Global,
  description?: string
): ClaudeAsset {
  // rootPath defaults to something that won't match any .claude/ patterns
  const rootPath = scope === AssetScope.Global ? '/home/user/.claude'
    : scope === AssetScope.Plugin ? '/home/user/.claude/plugins'
    : '/home/user/projects';
  return { type, name, filePath, scope, description, rootPath };
}

/**
 * Helper: find the Global container and return its Group-type children only.
 * ClaudeMd and Config are now flat leaves (NodeKind.Asset), not groups -- callers that
 * need those must access global.children directly and filter by kind.
 */
function getGlobalGroups(nodes: ReturnType<typeof buildTreeNodes>): GroupNodeDescriptor[] {
  const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
  if (!global) return [];
  return global.children.filter(c => c.kind === NodeKind.Group) as GroupNodeDescriptor[];
}

/**
 * Helper: find the Global container and return direct AssetNodeDescriptor leaves.
 * These are the flat ClaudeMd and Config leaves.
 */
function getGlobalLeaves(nodes: ReturnType<typeof buildTreeNodes>): AssetNodeDescriptor[] {
  const global = (nodes as ContainerNodeDescriptor[]).find(n => n.containerKind === 'global');
  if (!global) return [];
  return global.children.filter(c => c.kind === NodeKind.Asset) as AssetNodeDescriptor[];
}

describe('Tree node descriptors -- AC12: type groups per asset type (nested inside Global container)', () => {
  it('returns one group per asset type that has at least one asset', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'skill-a', '/skills/a/SKILL.md'),
      makeAsset(AssetType.Subagent, 'agent-a', '/agents/a.md'),
      makeAsset(AssetType.Skill, 'skill-b', '/skills/b/SKILL.md')
    ];

    const nodes = buildTreeNodes(assets);
    const groups = getGlobalGroups(nodes);

    const skillGroup = groups.find(g => g.assetType === AssetType.Skill);
    assert.ok(skillGroup, 'expected Skill group');

    const agentGroup = groups.find(g => g.assetType === AssetType.Subagent);
    assert.ok(agentGroup, 'expected Subagent group');

    // No Command type in assets -- should not appear
    const cmdGroup = groups.find(g => g.assetType === AssetType.Command);
    assert.strictEqual(cmdGroup, undefined, 'Command group should not appear when no commands present');
  });

  it('Skills and Agents groups defer to a backing directory (dirPath), with no precomputed children', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'skill-a', '/home/user/.claude/skills/skill-a/SKILL.md'),
      makeAsset(AssetType.Subagent, 'agent-a', '/home/user/.claude/agents/agent-a.md')
    ];

    const nodes = buildTreeNodes(assets);
    const groups = getGlobalGroups(nodes);

    const skillGroup = groups.find(g => g.assetType === AssetType.Skill)!;
    assert.strictEqual(skillGroup.dirPath, '/home/user/.claude/skills', 'Skills group mirrors the skills/ root');
    assert.strictEqual(skillGroup.children.length, 0, 'skill children come lazily from disk');

    const agentGroup = groups.find(g => g.assetType === AssetType.Subagent)!;
    assert.strictEqual(agentGroup.dirPath, '/home/user/.claude/agents', 'Agents group mirrors the agents/ root');
    assert.strictEqual(agentGroup.children.length, 0, 'agent children come lazily from disk');
  });

  it('Command group lists its assets as precomputed Asset children sorted alpha', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Command, 'cmd-b', '/home/user/.claude/commands/cmd-b.md'),
      makeAsset(AssetType.Command, 'cmd-a', '/home/user/.claude/commands/cmd-a.md')
    ];

    const nodes = buildTreeNodes(assets);
    const groups = getGlobalGroups(nodes);
    const cmdGroup = groups.find(g => g.assetType === AssetType.Command)!;
    assert.strictEqual(cmdGroup.dirPath, undefined, 'Command group is not directory-backed');
    const names = (cmdGroup.children as AssetNodeDescriptor[]).map(c => c.asset.name);
    assert.deepStrictEqual(names, ['cmd-a', 'cmd-b']);
  });
});

describe('Tree node descriptors -- AC14: asset node fields', () => {
  it('asset node carries filePath, resourceUri-compatible path, and contextValue', () => {
    const filePath = '/home/user/.claude/commands/my-cmd.md';
    const asset = makeAsset(AssetType.Command, 'my-cmd', filePath, AssetScope.Global, 'A great command');

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const cmdGroup = groups.find(g => g.assetType === AssetType.Command)!;
    const assetNode = cmdGroup.children[0] as AssetNodeDescriptor;

    assert.strictEqual(assetNode.asset.filePath, filePath, 'filePath must match');
    assert.strictEqual(assetNode.contextValue, 'asset-md-global', 'contextValue should reflect type and scope');
    assert.strictEqual(assetNode.label, 'my-cmd');
    assert.strictEqual(assetNode.tooltip, filePath);
  });

  it('config asset node has contextValue with asset-config prefix (flat leaf, no Group wrapper)', () => {
    const filePath = '/home/user/.claude/settings.json';
    const asset = makeAsset(AssetType.Config, 'settings.json', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    // Config is now a direct leaf, not inside a Group
    const leaves = getGlobalLeaves(nodes);
    const assetNode = leaves.find(a => a.asset.type === AssetType.Config)!;
    assert.ok(assetNode, 'expected Config leaf');
    assert.ok(assetNode.contextValue.startsWith('asset-config'), `expected asset-config prefix, got ${assetNode.contextValue}`);
  });

  it('markdown asset contextValue includes -md- for markdown files', () => {
    const filePath = '/home/user/.claude/commands/my-cmd.md';
    const asset = makeAsset(AssetType.Command, 'my-cmd', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const cmdGroup = groups.find(g => g.assetType === AssetType.Command)!;
    const assetNode = cmdGroup.children[0] as AssetNodeDescriptor;

    assert.ok(assetNode.contextValue.includes('-md-'), 'markdown asset should have -md- in contextValue');
  });
});

describe('Tree node descriptors -- Workflows (read-only)', () => {
  it('builds a workflows group with workflow-format leaves opened in the editor', () => {
    const filePath = '/home/user/.claude/workflows/review.js';
    const asset = makeAsset(AssetType.Workflow, 'review', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const group = getGlobalGroups(nodes).find(g => g.assetType === AssetType.Workflow)!;
    assert.ok(group, 'expected a workflows group');
    assert.strictEqual(group.label, 'workflows');
    // Read-only: no create target directory is wired for workflows.
    assert.strictEqual(group.createTargetDir, undefined, 'workflows group should not be creatable');

    const leaf = group.children[0] as AssetNodeDescriptor;
    assert.strictEqual(leaf.contextValue, 'asset-workflow-global');
    assert.strictEqual(leaf.commandId, 'claudeAssets.openFile', 'workflow scripts open in the plain editor');
  });

  it('shows an empty, read-only workflows group when ensureBaseDir is set and no workflows exist', () => {
    const skill = makeAsset(AssetType.Skill, 'skill-a', '/home/user/.claude/skills/skill-a/SKILL.md');
    const nodes = buildTreeNodes([skill], { globalClaudeDir: '/home/user/.claude' } as any);
    const group = getGlobalGroups(nodes).find(g => g.assetType === AssetType.Workflow);
    assert.ok(group, 'workflows group should be injected even when the folder is empty/absent');
    assert.strictEqual(group!.label, 'workflows');
    assert.strictEqual(group!.children.length, 0);
    assert.strictEqual(group!.createTargetDir, undefined, 'workflows stay read-only');
    assert.strictEqual(group!.dirPath, undefined, 'empty workflows group has no lazy dir backing');
  });
});

describe('Tree node descriptors -- default click command', () => {
  it('markdown asset descriptor has commandId claudeAssets.openMarkdown', () => {
    const filePath = '/home/user/.claude/commands/my-cmd.md';
    const asset = makeAsset(AssetType.Command, 'my-cmd', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const cmdGroup = groups.find(g => g.assetType === AssetType.Command)!;
    const assetNode = cmdGroup.children[0] as AssetNodeDescriptor;

    assert.strictEqual(assetNode.commandId, 'claudeAssets.openMarkdown', 'markdown asset default command should be openMarkdown');
    assert.strictEqual(assetNode.commandArgs[0], filePath, 'command argument should be the filePath');
  });

  it('config asset descriptor has commandId claudeAssets.openFile (flat leaf, no Group wrapper)', () => {
    const filePath = '/home/user/.claude/settings.json';
    const asset = makeAsset(AssetType.Config, 'settings.json', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    // Config is now a direct leaf, not inside a Group
    const leaves = getGlobalLeaves(nodes);
    const assetNode = leaves.find(a => a.asset.type === AssetType.Config)!;
    assert.ok(assetNode, 'expected Config leaf');
    assert.strictEqual(assetNode.commandId, 'claudeAssets.openFile', 'config asset default command should be openFile');
    assert.strictEqual(assetNode.commandArgs[0], filePath, 'command argument should be the filePath');
  });

  it('AssetNode TreeItem command uses commandId and commandArgs from descriptor (ClaudeMd is flat leaf)', () => {
    // This test verifies nodes.ts wires the descriptor fields into vscode.TreeItem.command
    // We test at the descriptor layer since nodes.ts requires vscode runtime.
    // Verify both fields are present and consistent.
    // ClaudeMd is now a direct leaf, not inside a Group.
    const filePath = '/home/user/.claude/CLAUDE.md';
    const asset = makeAsset(AssetType.ClaudeMd, 'CLAUDE.md', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const leaves = getGlobalLeaves(nodes);
    const assetNode = leaves.find(a => a.asset.type === AssetType.ClaudeMd)!;
    assert.ok(assetNode, 'expected CLAUDE.md flat leaf');

    assert.strictEqual(assetNode.commandId, 'claudeAssets.openMarkdown');
    assert.deepStrictEqual(assetNode.commandArgs, [filePath]);
  });
});

// ---------------------------------------------------------------------------
// Token usage flows through descriptors (per-asset usage + group totals)
// ---------------------------------------------------------------------------

describe('Tree node descriptors -- token usage', () => {
  const withUsage = (a: ClaudeAsset, upfront: number, rest: number): ClaudeAsset =>
    ({ ...a, tokenUsage: { upfront, rest, total: upfront + rest } });

  it('Command group sums its children into tokenTotals and each leaf carries tokenUsage', () => {
    const assets = [
      withUsage(makeAsset(AssetType.Command, 'c1', '/commands/c1.md'), 10, 100),
      withUsage(makeAsset(AssetType.Command, 'c2', '/commands/c2.md'), 5, 200)
    ];
    const groups = getGlobalGroups(buildTreeNodes(assets));
    const commands = groups.find(g => g.assetType === AssetType.Command)!;
    assert.ok(commands, 'expected a Command group');
    assert.deepStrictEqual(commands.tokenTotals, { upfront: 15, rest: 300, total: 315 });
    // Static command group keeps AssetNodeDescriptor children, each with usage.
    const c1 = commands.children.find(c => c.label === 'c1')!;
    assert.deepStrictEqual(c1.tokenUsage, { upfront: 10, rest: 100, total: 110 });
  });

  it('Skills group (lazy, no precomputed children) still reports summed tokenTotals', () => {
    const assets = [
      withUsage(makeAsset(AssetType.Skill, 'a', '/skills/a/SKILL.md'), 20, 1000),
      withUsage(makeAsset(AssetType.Skill, 'b', '/skills/b/SKILL.md'), 30, 2000)
    ];
    const groups = getGlobalGroups(buildTreeNodes(assets));
    const skills = groups.find(g => g.assetType === AssetType.Skill)!;
    assert.ok(skills.dirPath, 'skills group should be directory-backed (lazy children)');
    assert.strictEqual(skills.children.length, 0, 'lazy group has no precomputed children');
    assert.deepStrictEqual(skills.tokenTotals, { upfront: 50, rest: 3000, total: 3050 });
  });

  it('showTokenUsage=false strips token usage from assets and group totals', () => {
    const assets = [
      withUsage(makeAsset(AssetType.Command, 'c1', '/commands/c1.md'), 10, 100),
      withUsage(makeAsset(AssetType.Skill, 'a', '/skills/a/SKILL.md'), 20, 1000)
    ];
    const groups = getGlobalGroups(buildTreeNodes(assets, undefined, false));
    const commands = groups.find(g => g.assetType === AssetType.Command)!;
    const skills = groups.find(g => g.assetType === AssetType.Skill)!;
    assert.strictEqual(commands.tokenTotals, undefined, 'group totals stripped');
    assert.strictEqual(skills.tokenTotals, undefined, 'lazy group totals stripped');
    assert.strictEqual(commands.children[0].tokenUsage, undefined, 'asset usage stripped');
  });
});

describe('Tree node descriptors -- plugin token totals', () => {
  const installPath = '/home/user/.claude/plugins/cache/mk/foo/1.0.0';

  const pluginInfo = {
    name: 'foo', id: 'foo@mk', marketplace: 'mk', version: '1.0.0',
    installPath, lastUpdated: '', scope: 'user' as const
  };

  const pluginSkill = (): ClaudeAsset => ({
    type: AssetType.Skill, name: 's', filePath: `${installPath}/skills/s/SKILL.md`,
    scope: AssetScope.Plugin, description: 'd', rootPath: '/home/user/.claude/plugins',
    tokenUsage: { upfront: 12, rest: 340, total: 352 }
  });

  function findPluginFolder(nodes: ReturnType<typeof buildTreeNodes>): PluginFolderNodeDescriptor | undefined {
    let found: PluginFolderNodeDescriptor | undefined;
    const walk = (n: { kind: NodeKind; children?: unknown[] }): void => {
      if (n.kind === NodeKind.PluginFolder) { found = n as unknown as PluginFolderNodeDescriptor; return; }
      for (const c of (n.children ?? []) as { kind: NodeKind; children?: unknown[] }[]) walk(c);
    };
    for (const n of nodes) walk(n);
    return found;
  }

  it('enabled plugin folder reports the summed token total of its assets', () => {
    const nodes = buildTreeNodes([pluginSkill()], {
      installedPlugins: new Map([['foo', pluginInfo]]),
      outdated: new Set<string>(),
      enabled: new Map([['foo@mk', true]])
    });
    const folder = findPluginFolder(nodes);
    assert.ok(folder, 'plugin folder present');
    assert.deepStrictEqual(folder!.tokenTotals, { upfront: 12, rest: 340, total: 352 });
  });

  it('disabled plugin folder reports no token total (it does not load)', () => {
    const nodes = buildTreeNodes([pluginSkill()], {
      installedPlugins: new Map([['foo', pluginInfo]]),
      outdated: new Set<string>(),
      enabled: new Map([['foo@mk', false]])
    });
    const folder = findPluginFolder(nodes);
    assert.ok(folder, 'plugin folder present');
    assert.strictEqual(folder!.tokenTotals, undefined);
  });

  function findContainer(
    nodes: ReturnType<typeof buildTreeNodes>,
    kind: ContainerNodeDescriptor['containerKind']
  ): ContainerNodeDescriptor | undefined {
    let found: ContainerNodeDescriptor | undefined;
    const walk = (n: { kind: NodeKind; containerKind?: string; children?: unknown[] }): void => {
      if (n.kind === NodeKind.Container && n.containerKind === kind && !found) {
        found = n as unknown as ContainerNodeDescriptor;
      }
      for (const c of (n.children ?? []) as { kind: NodeKind; containerKind?: string; children?: unknown[] }[]) walk(c);
    };
    for (const n of nodes) walk(n);
    return found;
  }

  it('marketplace and plugins-root containers sum their enabled plugins', () => {
    const bar = {
      name: 'bar', id: 'bar@mk', marketplace: 'mk', version: '2.0.0',
      installPath: '/home/user/.claude/plugins/cache/mk/bar/2.0.0', lastUpdated: '', scope: 'user' as const
    };
    const barSkill: ClaudeAsset = {
      type: AssetType.Skill, name: 'b', filePath: `${bar.installPath}/skills/b/SKILL.md`,
      scope: AssetScope.Plugin, description: 'd', rootPath: '/home/user/.claude/plugins',
      tokenUsage: { upfront: 8, rest: 60, total: 68 }
    };
    const nodes = buildTreeNodes([pluginSkill(), barSkill], {
      installedPlugins: new Map([['foo', pluginInfo], ['bar', bar]]),
      outdated: new Set<string>(),
      // foo enabled, bar disabled -> only foo counts.
      enabled: new Map([['foo@mk', true], ['bar@mk', false]])
    });
    const mk = findContainer(nodes, 'marketplace');
    const root = findContainer(nodes, 'plugins');
    assert.deepStrictEqual(mk!.tokenTotals, { upfront: 12, rest: 340, total: 352 }, 'marketplace sums enabled only');
    assert.deepStrictEqual(root!.tokenTotals, { upfront: 12, rest: 340, total: 352 }, 'plugins root sums enabled only');
  });
});
