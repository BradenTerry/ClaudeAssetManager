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

  it('expanding a group returns that type assets as items', () => {
    const assets: ClaudeAsset[] = [
      makeAsset(AssetType.Skill, 'skill-a', '/skills/a/SKILL.md'),
      makeAsset(AssetType.Skill, 'skill-b', '/skills/b/SKILL.md'),
      makeAsset(AssetType.Subagent, 'agent-a', '/agents/a.md')
    ];

    const nodes = buildTreeNodes(assets);
    const groups = getGlobalGroups(nodes);
    const skillGroup = groups.find(g => g.assetType === AssetType.Skill)!;
    assert.ok(skillGroup, 'expected Skill group');

    const children = skillGroup.children;
    assert.strictEqual(children.length, 2, 'expected 2 skill children');
    assert.ok(children.every(c => c.kind === NodeKind.Asset), 'all children should be Asset nodes');
    const names = (children as AssetNodeDescriptor[]).map(c => c.asset.name);
    assert.ok(names.includes('skill-a'));
    assert.ok(names.includes('skill-b'));
  });
});

describe('Tree node descriptors -- AC14: asset node fields', () => {
  it('asset node carries filePath, resourceUri-compatible path, and contextValue', () => {
    const filePath = '/home/user/.claude/skills/my-skill/SKILL.md';
    const asset = makeAsset(AssetType.Skill, 'my-skill', filePath, AssetScope.Global, 'A great skill');

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const skillGroup = groups.find(g => g.assetType === AssetType.Skill)!;
    const assetNode = skillGroup.children[0] as AssetNodeDescriptor;

    assert.strictEqual(assetNode.asset.filePath, filePath, 'filePath must match');
    assert.strictEqual(assetNode.contextValue, 'asset-md-global', 'contextValue should reflect type and scope');
    assert.strictEqual(assetNode.label, 'my-skill');
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
    const filePath = '/home/user/.claude/agents/my-agent.md';
    const asset = makeAsset(AssetType.Subagent, 'my-agent', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const agentGroup = groups.find(g => g.assetType === AssetType.Subagent)!;
    const assetNode = agentGroup.children[0] as AssetNodeDescriptor;

    assert.ok(assetNode.contextValue.includes('-md-'), 'markdown asset should have -md- in contextValue');
  });
});

describe('Tree node descriptors -- default click command', () => {
  it('markdown asset descriptor has commandId claudeAssets.openPreview', () => {
    const filePath = '/home/user/.claude/skills/my-skill/SKILL.md';
    const asset = makeAsset(AssetType.Skill, 'my-skill', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const skillGroup = groups.find(g => g.assetType === AssetType.Skill)!;
    const assetNode = skillGroup.children[0] as AssetNodeDescriptor;

    assert.strictEqual(assetNode.commandId, 'claudeAssets.openPreview', 'markdown asset default command should be openPreview');
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

  it('subagent (markdown) asset descriptor has commandId claudeAssets.openPreview', () => {
    const filePath = '/home/user/.claude/agents/my-agent.md';
    const asset = makeAsset(AssetType.Subagent, 'my-agent', filePath, AssetScope.Global);

    const nodes = buildTreeNodes([asset]);
    const groups = getGlobalGroups(nodes);
    const agentGroup = groups.find(g => g.assetType === AssetType.Subagent)!;
    const assetNode = agentGroup.children[0] as AssetNodeDescriptor;

    assert.strictEqual(assetNode.commandId, 'claudeAssets.openPreview');
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

    assert.strictEqual(assetNode.commandId, 'claudeAssets.openPreview');
    assert.deepStrictEqual(assetNode.commandArgs, [filePath]);
  });
});
