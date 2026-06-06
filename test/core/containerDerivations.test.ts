import * as assert from 'assert';
import { derivePluginName, deriveProjectName, deriveProjectInfo } from '../../src/core/containerDerivations';
import { AssetType, AssetScope, ClaudeAsset } from '../../src/core/types';

function makeAsset(
  filePath: string,
  scope: AssetScope,
  rootPath: string,
  type: AssetType = AssetType.Skill,
  name: string = 'test-asset'
): ClaudeAsset {
  return { type, name, filePath, scope, description: undefined, rootPath };
}

// ---------------------------------------------------------------------------
// derivePluginName
// ---------------------------------------------------------------------------

describe('derivePluginName -- plugin name extraction from path', () => {
  it('cache/<marketplace>/<PLUGIN>/<version>/... -> PLUGIN', () => {
    const filePath = '/Users/braden/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/SKILL.md';
    assert.strictEqual(derivePluginName(filePath), 'claude-code-setup');
  });

  it('marketplaces/<mk>/plugins/<PLUGIN>/... -> PLUGIN', () => {
    const filePath = '/Users/braden/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md';
    assert.strictEqual(derivePluginName(filePath), 'frontend-design');
  });

  it('marketplaces/<mk>/external_plugins/<PLUGIN>/... -> PLUGIN', () => {
    const filePath = '/Users/braden/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/skills/access/SKILL.md';
    assert.strictEqual(derivePluginName(filePath), 'discord');
  });

  it('cache/<marketplace>/<PLUGIN>/<version>/agents/... -> PLUGIN', () => {
    const filePath = '/Users/braden/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/agents/analyzer.md';
    assert.strictEqual(derivePluginName(filePath), 'skill-creator');
  });

  it('plugins/<PLUGIN>/... (direct) -> PLUGIN', () => {
    const filePath = '/Users/braden/.claude/plugins/my-local-plugin/skills/do-thing/SKILL.md';
    assert.strictEqual(derivePluginName(filePath), 'my-local-plugin');
  });

  it('returns "unknown" when path has no segments after plugins/', () => {
    // Degenerate: path ends exactly at plugins dir
    const filePath = '/Users/braden/.claude/plugins';
    assert.strictEqual(derivePluginName(filePath), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// deriveProjectName
// ---------------------------------------------------------------------------

describe('deriveProjectName -- project name from asset path', () => {
  it('.claude ancestor: segment immediately above .claude', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/Test/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), 'Test');
  });

  it('.claude ancestor deeper nesting', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/MyApp/.claude/agents/helper.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), 'MyApp');
  });

  it('root CLAUDE.md with no .claude ancestor: basename of file directory', () => {
    // A CLAUDE.md sitting at project root without .claude segment
    const asset = makeAsset(
      '/Users/braden/Projects/SomeProject/CLAUDE.md',
      AssetScope.Project,
      '/Users/braden/Projects',
      AssetType.ClaudeMd,
      'CLAUDE.md'
    );
    assert.strictEqual(deriveProjectName(asset), 'SomeProject');
  });

  it('loose asset relative to rootPath: first path segment from root', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/foo/skills/bar/SKILL.md',
      AssetScope.Registered,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), 'foo');
  });

  it('loose asset sitting directly in rootPath: basename(rootPath)', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/SKILL.md',
      AssetScope.Registered,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), 'Projects');
  });

  it('loose asset one level under rootPath: first segment', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/bar/CLAUDE.md',
      AssetScope.Registered,
      '/Users/braden/Projects',
      AssetType.ClaudeMd,
      'CLAUDE.md'
    );
    assert.strictEqual(deriveProjectName(asset), 'bar');
  });
});

// ---------------------------------------------------------------------------
// deriveProjectInfo
// ---------------------------------------------------------------------------

describe('deriveProjectInfo -- project + worktree extraction', () => {
  it('AC-DRV-1: main asset under .claude returns project name and worktree null', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/Workouts/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    const info = deriveProjectInfo(asset);
    assert.strictEqual(info.project, 'Workouts');
    assert.strictEqual(info.worktree, null);
  });

  it('AC-DRV-2: worktree asset (double .claude) returns project name and worktree name', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    const info = deriveProjectInfo(asset);
    assert.strictEqual(info.project, 'Workouts');
    assert.strictEqual(info.worktree, 'agent-ac745f103f192bf4f');
  });

  it('AC-DRV-3: second worktree in a different project', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/TestRunner/.claude/worktrees/happy-dancing-flask/.claude/agents/bar.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    const info = deriveProjectInfo(asset);
    assert.strictEqual(info.project, 'TestRunner');
    assert.strictEqual(info.worktree, 'happy-dancing-flask');
  });

  it('AC-DRV-4: asset with no .claude segment falls back to rootPath-relative logic, worktree is null', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/foo/skills/bar/SKILL.md',
      AssetScope.Registered,
      '/Users/braden/Projects'
    );
    const info = deriveProjectInfo(asset);
    assert.strictEqual(info.project, 'foo');
    assert.strictEqual(info.worktree, null);
  });

  it('AC-DRV-5: uses FIRST .claude only -- second .claude does not change project name', () => {
    // The path has two .claude segments; project must be derived from BEFORE the first one
    const asset = makeAsset(
      '/Users/braden/Projects/Workouts/.claude/worktrees/agent-abc/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    const info = deriveProjectInfo(asset);
    // Must be 'Workouts', NOT whatever is above the second .claude
    assert.strictEqual(info.project, 'Workouts');
    assert.strictEqual(info.worktree, 'agent-abc');
  });

  it('AC-DRV-6: deriveProjectName returns same value as deriveProjectInfo.project for main asset', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/Workouts/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), deriveProjectInfo(asset).project);
  });

  it('AC-DRV-6b: deriveProjectName returns same value as deriveProjectInfo.project for worktree asset', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), deriveProjectInfo(asset).project);
  });

  it('AC-DRV-6c: deriveProjectName remains correct for worktree asset (uses FIRST .claude)', () => {
    const asset = makeAsset(
      '/Users/braden/Projects/Workouts/.claude/worktrees/agent-ac745f103f192bf4f/.claude/skills/foo/SKILL.md',
      AssetScope.Project,
      '/Users/braden/Projects'
    );
    assert.strictEqual(deriveProjectName(asset), 'Workouts');
  });
});
