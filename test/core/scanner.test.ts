import * as assert from 'assert';
import * as path from 'path';
import { makeTempDir, writeFile, mkdir, trySymlink, buildGlobalClaudeDir } from './fixtures';
import { scan } from '../../src/core/scanner';
import { buildScanRoots } from '../../src/core/scanRoots';
import { AssetType, AssetScope } from '../../src/core/types';

// Default noise dirs list
const DEFAULT_EXCLUDE = ['node_modules', '.git', 'bin', 'obj', 'dist', 'target', '.venv', 'venv', '.idea', '.vs'];

describe('Scanner -- AC1: Skills with frontmatter', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('returns a Skill asset with name/description from frontmatter, scope Global', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    const skillDir = path.join(claudeDir, 'skills', 'my-skill');
    writeFile(path.join(skillDir, 'SKILL.md'), `---
name: my-skill
description: A useful skill
allowed-tools:
  - Bash
---
# My Skill
`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const skills = assets.filter(a => a.type === AssetType.Skill);
    assert.ok(skills.length >= 1, 'expected at least one skill');
    const skill = skills.find(s => s.name === 'my-skill');
    assert.ok(skill, 'skill named "my-skill" not found');
    assert.strictEqual(skill.description, 'A useful skill');
    assert.strictEqual(skill.scope, AssetScope.Global);
  });
});

describe('Scanner -- AC2: Subagents with frontmatter', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('returns a Subagent asset with name/description/tools, scope Global', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'agents', 'my-agent.md'), `---
name: my-agent
description: A helpful agent
tools: Bash, Read, Write
model: claude-opus-4-5
---
# My Agent
`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const agents = assets.filter(a => a.type === AssetType.Subagent);
    assert.ok(agents.length >= 1, 'expected at least one subagent');
    const agent = agents.find(a => a.name === 'my-agent');
    assert.ok(agent, 'agent "my-agent" not found');
    assert.strictEqual(agent.description, 'A helpful agent');
    assert.strictEqual(agent.scope, AssetScope.Global);
    assert.deepStrictEqual(agent.tools, ['Bash', 'Read', 'Write'], 'tools must be parsed into a string array');
  });

  it('returns a Subagent asset with tools parsed from a YAML list', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'agents', 'list-agent.md'), `---
name: list-agent
description: Agent with list tools
allowed-tools:
  - Bash
  - Edit
  - Read
---
# List Agent
`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const agent = assets.find(a => a.name === 'list-agent');
    assert.ok(agent, 'list-agent not found');
    assert.deepStrictEqual(agent.tools, ['Bash', 'Edit', 'Read'], 'tools from allowed-tools YAML list must be parsed into a string array');
  });
});

describe('Scanner -- AC3: Commands including namespaced subdirs', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('returns Command asset with simple name', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'commands', 'deploy.md'), `# Deploy command\nRuns deployment.`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const cmds = assets.filter(a => a.type === AssetType.Command);
    assert.ok(cmds.length >= 1, 'expected at least one command');
    const cmd = cmds.find(c => c.name === 'deploy');
    assert.ok(cmd, 'command "deploy" not found');
  });

  it('returns Command with namespaced name for subdir command', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'commands', 'foo', 'bar.md'), `# Foo bar command\n`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const cmds = assets.filter(a => a.type === AssetType.Command);
    const cmd = cmds.find(c => c.name === 'foo/bar');
    assert.ok(cmd, 'namespaced command "foo/bar" not found');
  });
});

describe('Scanner -- AC4: CLAUDE.md and Memory assets', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('returns ClaudeMd asset for CLAUDE.md at project root', () => {
    const projectDir = path.join(root, 'myproject');
    mkdir(projectDir);
    writeFile(path.join(projectDir, 'CLAUDE.md'), `# Project instructions\nDo things this way.\n`);

    const roots = buildScanRoots(path.join(root, '.claude-nonexistent'), [], [projectDir]);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const claudeMds = assets.filter(a => a.type === AssetType.ClaudeMd);
    assert.ok(claudeMds.length >= 1, 'expected at least one CLAUDE.md asset');
  });

  it('returns Memory assets for MEMORY.md and per-fact files', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    const memDir = path.join(claudeDir, 'projects', 'myproject', 'memory');
    writeFile(path.join(memDir, 'MEMORY.md'), `# Memory index\n`);
    writeFile(path.join(memDir, 'fact-one.md'), `# Fact one\nSome remembered fact.\n`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const memories = assets.filter(a => a.type === AssetType.Memory);
    assert.ok(memories.length >= 2, `expected at least 2 memory assets, got ${memories.length}`);
    assert.ok(memories.some(m => m.filePath.endsWith('MEMORY.md')), 'MEMORY.md not found');
    assert.ok(memories.some(m => m.filePath.endsWith('fact-one.md')), 'fact-one.md not found');
  });
});

describe('Scanner -- AC5: Config assets', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('returns Config assets for settings.json, settings.local.json, keybindings.json', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'settings.json'), `{"theme": "dark"}`);
    writeFile(path.join(claudeDir, 'settings.local.json'), `{"customKey": "value"}`);
    writeFile(path.join(claudeDir, 'keybindings.json'), `[{"key": "ctrl+s"}]`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const configs = assets.filter(a => a.type === AssetType.Config);
    const names = configs.map(c => c.name);
    assert.ok(names.includes('settings.json'), 'settings.json not found');
    assert.ok(names.includes('settings.local.json'), 'settings.local.json not found');
    assert.ok(names.includes('keybindings.json'), 'keybindings.json not found');
  });

  it('only treats settings.json inside a .claude/ dir as Config (excludes .vscode and loose files)', () => {
    const home = path.join(root, '.claude');
    buildGlobalClaudeDir(home);
    const proj = path.join(root, 'workspace', 'MyApp');
    writeFile(path.join(proj, '.claude', 'settings.json'), `{"a":1}`);            // the Claude one
    writeFile(path.join(proj, '.claude', 'settings.local.json'), `{"b":2}`);      // the Claude local one
    writeFile(path.join(proj, '.vscode', 'settings.json'), `{"editor.tabSize":2}`); // NOT Claude
    writeFile(path.join(proj, 'settings.json'), `{"random":true}`);               // NOT Claude

    const roots = buildScanRoots(home, [path.join(root, 'workspace')], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });
    const configPaths = assets
      .filter(a => a.type === AssetType.Config)
      .map(a => a.filePath.replace(/\\/g, '/'));

    assert.ok(configPaths.some(p => p.endsWith('/MyApp/.claude/settings.json')), 'claude settings.json should be Config');
    assert.ok(configPaths.some(p => p.endsWith('/MyApp/.claude/settings.local.json')), 'claude settings.local.json should be Config');
    assert.ok(!configPaths.some(p => p.includes('/.vscode/')), '.vscode/settings.json must NOT be Config');
    assert.ok(!configPaths.some(p => p.endsWith('/MyApp/settings.json')), 'loose settings.json must NOT be Config');
  });
});

describe('Scanner -- AC6: Symlink following', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('follows a symlinked skills directory and returns assets (skipped if OS forbids symlinks)', function () {
    const realSkillsDir = path.join(root, 'real-skills');
    const skillDir = path.join(realSkillsDir, 'linked-skill');
    writeFile(path.join(skillDir, 'SKILL.md'), `---
name: linked-skill
description: Found via symlink
---
# Linked Skill
`);

    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    // Remove the skills dir created by buildGlobalClaudeDir
    try { require('fs').rmdirSync(path.join(claudeDir, 'skills')); } catch { /* may fail if not empty */ }
    require('fs').rmSync(path.join(claudeDir, 'skills'), { recursive: true, force: true });

    const created = trySymlink(realSkillsDir, path.join(claudeDir, 'skills'));
    if (!created) {
      this.skip(); // graceful skip if OS forbids symlinks
      return;
    }

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const skills = assets.filter(a => a.type === AssetType.Skill);
    const skill = skills.find(s => s.name === 'linked-skill');
    assert.ok(skill, 'expected to find linked-skill via symlink');
    assert.strictEqual(skill.description, 'Found via symlink');
  });
});

describe('Scanner -- AC7: Noise dir pruning', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('skips node_modules and returns assets from valid dirs', () => {
    const registeredDir = path.join(root, 'project');
    mkdir(registeredDir);
    // Valid asset
    writeFile(path.join(registeredDir, '.claude', 'agents', 'good-agent.md'), `---
name: good-agent
description: Valid agent
---
`);
    // Asset inside node_modules - should be pruned
    writeFile(path.join(registeredDir, 'node_modules', 'some-pkg', '.claude', 'skills', 'noise-skill', 'SKILL.md'), `---
name: noise-skill
description: Should be pruned
---
`);

    const claudeDir = path.join(root, '.claude-fake');
    const roots = buildScanRoots(claudeDir, [registeredDir], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const noiseSkill = assets.find(a => a.name === 'noise-skill');
    assert.strictEqual(noiseSkill, undefined, 'noise-skill under node_modules should be pruned');

    const goodAgent = assets.find(a => a.name === 'good-agent');
    assert.ok(goodAgent, 'good-agent should be found');
  });
});

describe('Scanner -- AC8: Scope classification', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('assigns Global scope for ~/.claude assets', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'settings.json'), '{}');

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const config = assets.find(a => a.name === 'settings.json');
    assert.ok(config, 'settings.json not found');
    assert.strictEqual(config.scope, AssetScope.Global);
  });

  it('assigns Plugin scope for installed plugin assets under plugins/cache/', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    // Installed plugins live under plugins/cache/ (the dedicated plugin root)
    const pluginDir = path.join(claudeDir, 'plugins', 'cache', 'myplugin', '.claude');
    writeFile(path.join(pluginDir, 'settings.json'), '{}');

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const plugin = assets.find(a => a.scope === AssetScope.Plugin);
    assert.ok(plugin, 'expected a Plugin-scoped asset from plugins/cache/');
  });

  it('assigns Project scope for assets under a workspace .claude/', () => {
    const workspaceDir = path.join(root, 'workspace');
    mkdir(workspaceDir);
    writeFile(path.join(workspaceDir, '.claude', 'agents', 'ws-agent.md'), `---
name: ws-agent
description: Workspace agent
---
`);

    const claudeDir = path.join(root, '.claude-fake');
    const roots = buildScanRoots(claudeDir, [], [workspaceDir]);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const agent = assets.find(a => a.name === 'ws-agent');
    assert.ok(agent, 'ws-agent not found');
    assert.strictEqual(agent.scope, AssetScope.Project);
  });

  it('assigns Project scope for assets nested under .claude/ inside a registered dir', () => {
    const regDir = path.join(root, 'registered');
    mkdir(regDir);
    writeFile(path.join(regDir, '.claude', 'agents', 'reg-agent.md'), `---
name: reg-agent
description: Registered agent
---
`);

    const claudeDir = path.join(root, '.claude-fake');
    const roots = buildScanRoots(claudeDir, [regDir], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const agent = assets.find(a => a.name === 'reg-agent');
    assert.ok(agent, 'reg-agent not found');
    assert.strictEqual(agent.scope, AssetScope.Project, 'asset under .claude/ in a registered dir must be Project scope');
  });

  it('assigns Registered scope for a loose asset under a registered dir (no .claude/ segment)', () => {
    const regDir = path.join(root, 'registered-loose');
    mkdir(regDir);
    // A SKILL.md directly reachable without .claude/ nesting
    writeFile(path.join(regDir, 'skills', 'loose-skill', 'SKILL.md'), `---
name: loose-skill
description: Loose registered skill
---
`);

    const claudeDir = path.join(root, '.claude-fake');
    const roots = buildScanRoots(claudeDir, [regDir], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const skill = assets.find(a => a.name === 'loose-skill');
    assert.ok(skill, 'loose-skill not found');
    assert.strictEqual(skill.scope, AssetScope.Registered, 'loose asset under registered dir (no .claude/ segment) must be Registered scope');
  });
});

describe('Scanner -- AC10: Extra registered directories', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('includes assets from registered dirs in addition to global root', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);
    writeFile(path.join(claudeDir, 'settings.json'), '{}');

    const regDir = path.join(root, 'extra-project');
    writeFile(path.join(regDir, '.claude', 'agents', 'extra-agent.md'), `---
name: extra-agent
description: From registered dir
---
`);

    const roots = buildScanRoots(claudeDir, [regDir], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const config = assets.find(a => a.name === 'settings.json');
    assert.ok(config, 'global settings.json not found');

    const agent = assets.find(a => a.name === 'extra-agent');
    assert.ok(agent, 'extra-agent from registered dir not found');
  });
});

describe('Scanner -- AC12: Global home root must NOT descend into plugins/ or projects/ subtrees', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('marketplace plugins under plugins/marketplaces/ do NOT appear when scanning via global root', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);

    // Simulate a non-installed marketplace plugin at plugins/marketplaces/ using a real
    // skill structure: plugins/marketplaces/<registry>/plugins/<name>/.claude/skills/<skill>/SKILL.md
    writeFile(
      path.join(claudeDir, 'plugins', 'marketplaces', 'my-registry', 'plugins', 'code-review', '.claude', 'skills', 'code-review-skill', 'SKILL.md'),
      `---\nname: code-review-skill\ndescription: Marketplace plugin, not installed\n---\n`
    );

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const marketplaceAsset = assets.find(a => a.name === 'code-review-skill');
    assert.strictEqual(
      marketplaceAsset,
      undefined,
      'marketplace plugin skill must NOT appear -- plugins/ subtree is off-limits for the global root'
    );
  });

  it('installed plugin assets under plugins/cache/ DO appear (via the dedicated plugin root)', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);

    // Simulate an installed plugin in plugins/cache/
    writeFile(
      path.join(claudeDir, 'plugins', 'cache', 'installed-skill-plugin', 'skills', 'my-cached-skill', 'SKILL.md'),
      `---\nname: my-cached-skill\ndescription: Installed plugin skill\n---\n`
    );

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const cached = assets.find(a => a.name === 'my-cached-skill');
    assert.ok(cached, 'installed plugin skill must appear via the plugins/cache dedicated root');
    assert.strictEqual(cached.scope, AssetScope.Plugin, 'installed plugin skill must have Plugin scope');
  });

  it('projects/memory assets still appear (via the dedicated memory root)', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);

    // Memory file in projects/myproject/memory/
    writeFile(
      path.join(claudeDir, 'projects', 'myproject', 'memory', 'MEMORY.md'),
      `# Memory index\n`
    );

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const mem = assets.find(a => a.filePath.endsWith('MEMORY.md'));
    assert.ok(mem, 'MEMORY.md must still appear via the dedicated projects/memory root');
  });

  it('top-level global assets (skills, agents, settings) are NOT affected by the pruning', () => {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);

    writeFile(path.join(claudeDir, 'settings.json'), '{}');
    writeFile(path.join(claudeDir, 'skills', 'global-skill', 'SKILL.md'), `---\nname: global-skill\ndescription: Top-level global skill\n---\n`);

    const roots = buildScanRoots(claudeDir, [], []);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const settings = assets.find(a => a.name === 'settings.json');
    assert.ok(settings, 'settings.json must still be found');
    assert.strictEqual(settings.scope, AssetScope.Global);

    const globalSkill = assets.find(a => a.name === 'global-skill');
    assert.ok(globalSkill, 'global-skill must still be found');
    assert.strictEqual(globalSkill.scope, AssetScope.Global);
  });

  it('a project dir named "plugins" under a workspace root is NOT affected by global-root pruning', () => {
    // Guard against over-broad exclusion: only the global home root prunes plugins/projects
    const workspaceDir = path.join(root, 'my-workspace');
    writeFile(
      path.join(workspaceDir, 'plugins', 'CLAUDE.md'),
      `# Project instructions inside a dir named plugins\n`
    );

    const claudeDir = path.join(root, '.claude-fake');
    const roots = buildScanRoots(claudeDir, [], [workspaceDir]);
    const assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });

    const claudeMd = assets.find(a => a.type === AssetType.ClaudeMd);
    assert.ok(claudeMd, 'CLAUDE.md inside a project-level "plugins" dir must still be found');
  });
});

describe('Scanner -- AC11: Symlink cycle detection', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('terminates scan without error when symlink cycle exists', function () {
    const claudeDir = path.join(root, '.claude');
    buildGlobalClaudeDir(claudeDir);

    // Create a real skill so we have a legitimate asset
    writeFile(path.join(claudeDir, 'skills', 'real-skill', 'SKILL.md'), `---
name: real-skill
description: A real skill
---
`);

    // Create a cycle: skills/cycle -> skills/
    const cycleLink = path.join(claudeDir, 'skills', 'cycle');
    const created = trySymlink(path.join(claudeDir, 'skills'), cycleLink);
    if (!created) {
      this.skip();
      return;
    }

    // Should not throw or hang
    const roots = buildScanRoots(claudeDir, [], []);
    let assets: ReturnType<typeof scan>;
    assert.doesNotThrow(() => {
      assets = scan(roots, { excludeDirs: DEFAULT_EXCLUDE, followSymlinks: true });
    });

    // The real skill should still be found
    const realSkill = assets!.find(a => a.name === 'real-skill');
    assert.ok(realSkill, 'real-skill should still be found after cycle detection');
  });
});
