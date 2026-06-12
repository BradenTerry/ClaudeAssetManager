import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Importing the mock first installs the require('vscode') hook BEFORE the
// extension (and its vscode-coupled modules) are loaded below.
import { vscodeMock, harness, lastMessage, fireDidSave } from './vscodeMock';
import { makeTempDir, writeFile, mkdir } from '../core/fixtures';
import { AssetType, AssetScope, ClaudeAsset } from '../../src/core/types';
import { computeTokenUsage } from '../../src/core/tokenCount';
// Resolved through the vscode hook installed above.
import { AssetTreeProvider } from '../../src/tree/assetTreeProvider';

// Load the real extension through the hook. Required (not imported) so it
// resolves after the hook above is installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extension = require('../../src/extension') as { activate: (ctx: unknown) => void };

const exec = (command: string, ...args: unknown[]): Promise<unknown> =>
  vscodeMock.commands.executeCommand(command, ...args);

// The aggregate token summary is the first tree row (info icon + (a)/(d) totals),
// rendered only when the section's token toggle is on. Returns its label or undefined.
const summaryLabel = (viewId: string): string | undefined => {
  const provider = harness.treeViews[viewId]?.provider;
  const rows = (provider?.getChildren() ?? []) as Array<{ contextValue?: string; label?: string }>;
  return rows.find(r => r.contextValue === 'tokenSummary')?.label;
};

describe('extension integration', () => {
  let originalHome: string | undefined;
  let cleanup: () => void;
  let originalUserProfile: string | undefined;
  let home: string;
  let claudeDir: string;

  // The extension's runScan() sets up a recursive fs.watch on the .claude tree.
  // That is not under test here, and on Windows libuv aborts the process when a
  // watched dir is removed (which our temp-dir teardown does). Stub fs.watch to
  // an inert watcher so no real OS handle is ever created. Patch the underlying
  // require('fs') module object -- the `import * as fs` namespaces (here and in
  // watcher.ts) are getter wrappers that read through to it at call time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const realFs = require('fs') as { watch: unknown };
  const realWatch = realFs.watch;
  before(() => {
    Object.defineProperty(realFs, 'watch', {
      value: () => ({ on: () => { /* no-op */ }, close: () => { /* no-op */ } }),
      configurable: true,
      writable: true
    });
  });
  after(() => {
    Object.defineProperty(realFs, 'watch', { value: realWatch, configurable: true, writable: true });
  });

  beforeEach(() => {
    // Point os.homedir() at a temp dir so ~/.claude is sandboxed per test.
    // os.homedir() reads HOME on POSIX and USERPROFILE on Windows, so set both.
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    home = tmp.root;
    process.env.HOME = home;
    process.env.USERPROFILE = home;

    claudeDir = path.join(home, '.claude');
    mkdir(path.join(claudeDir, 'skills'));
    mkdir(path.join(claudeDir, 'agents'));
    mkdir(path.join(claudeDir, 'commands'));
    mkdir(path.join(claudeDir, 'plugins'));
    mkdir(path.join(claudeDir, 'projects'));

    harness.reset();
    // No registered dirs, no workspace folder -> the scan stays within temp HOME.
    harness.config['claudeAssets.directories'] = [];
    harness.workspaceFolders = [];

    // Fresh activation: all mutable state lives inside the activate() closure,
    // and registerCommand overwrites the registry with this run's handlers.
    extension.activate({ subscriptions: { push: () => { /* no-op */ } } });
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Sanity: activation registered the commands we exercise.
  // -------------------------------------------------------------------------

  describe('activation', () => {
    it('registers the deleteFile and create commands', async () => {
      // executeCommand returns a registered handler's result; an unknown id is
      // recorded as a built-in instead. Probe via a no-op-ish command.
      harness.inputResponses.push(undefined); // createSkill cancels (no name)
      await exec('claudeAssets.createSkill', { createTargetDir: path.join(claudeDir, 'skills') });
      // If createSkill were unregistered, it would have been recorded as a built-in.
      assert.strictEqual(harness.executed.find(e => e.command === 'claudeAssets.createSkill'), undefined);
    });
  });

  // -------------------------------------------------------------------------
  // deleteFile -- the headline feature.
  // -------------------------------------------------------------------------

  describe('claudeAssets.deleteFile', () => {
    it('deletes a confirmed file from disk', async () => {
      const file = path.join(claudeDir, 'skills', 'note.md');
      writeFile(file, '# note');
      harness.warningResponses.push('Delete'); // confirm
      await exec('claudeAssets.deleteFile', file);
      assert.ok(!fs.existsSync(file), 'file should be gone after confirmed delete');
    });

    it('deletes a confirmed folder recursively', async () => {
      const dir = path.join(claudeDir, 'skills', 'my-skill');
      writeFile(path.join(dir, 'SKILL.md'), '# s');
      writeFile(path.join(dir, 'sub', 'extra.md'), 'x');
      harness.warningResponses.push('Delete');
      await exec('claudeAssets.deleteFile', dir);
      assert.ok(!fs.existsSync(dir), 'folder tree should be gone after confirmed delete');
    });

    it('keeps the file when the confirm dialog is dismissed', async () => {
      const file = path.join(claudeDir, 'agents', 'keep.md');
      writeFile(file, 'k');
      // No queued warning response -> dialog returns undefined (cancel).
      await exec('claudeAssets.deleteFile', file);
      assert.ok(fs.existsSync(file), 'file must survive a cancelled delete');
    });

    it('refuses to delete inside the Claude-managed plugins tree', async () => {
      const pluginFile = path.join(claudeDir, 'plugins', 'repos', 'acme', 'SKILL.md');
      writeFile(pluginFile, 'managed');
      harness.warningResponses.push('Delete'); // even if confirmed, must be refused first
      await exec('claudeAssets.deleteFile', pluginFile);
      assert.ok(fs.existsSync(pluginFile), 'plugin file must not be deleted');
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'info');
      assert.ok(/managed by Claude/i.test(msg!.text), 'should explain plugins are managed');
    });

    it('errors when no path can be resolved', async () => {
      await exec('claudeAssets.deleteFile', undefined);
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'error');
      assert.ok(/no path/i.test(msg!.text));
    });

    it('errors when the target no longer exists', async () => {
      const ghost = path.join(claudeDir, 'skills', 'ghost.md');
      await exec('claudeAssets.deleteFile', ghost);
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'error');
      assert.ok(/no longer exists/i.test(msg!.text));
    });

    it('resolves the path off a tree node argument (resourceUri)', async () => {
      const file = path.join(claudeDir, 'commands', 'fromNode.md');
      writeFile(file, 'n');
      harness.warningResponses.push('Delete');
      // Context-menu invocations pass the node, not a string.
      await exec('claudeAssets.deleteFile', { resourceUri: vscodeMock.Uri.file(file) });
      assert.ok(!fs.existsSync(file), 'node-arg delete should remove the file');
    });

    // --- Windows lock simulation: EBUSY/EPERM from an open handle. ---

    it('retries past a transient EBUSY (simulated Windows lock) and deletes', async () => {
      const file = path.join(claudeDir, 'skills', 'locked.md');
      writeFile(file, 'x');
      harness.warningResponses.push('Delete');
      harness.fsDeleteErrorCode = 'EBUSY';
      harness.fsDeleteFailuresRemaining = 2; // fail twice, succeed on the 3rd
      await exec('claudeAssets.deleteFile', file);
      assert.ok(!fs.existsSync(file), 'file should be deleted after retries');
      assert.strictEqual(harness.fsDeleteCalls, 3, 'should have retried twice then succeeded');
      assert.strictEqual(harness.messages.find(m => m.level === 'error'), undefined, 'no error on eventual success');
    });

    it('surfaces an error after exhausting retries on a persistent EPERM', async () => {
      const file = path.join(claudeDir, 'skills', 'stuck.md');
      writeFile(file, 'x');
      harness.warningResponses.push('Delete');
      harness.fsDeleteErrorCode = 'EPERM';
      harness.fsDeleteFailuresRemaining = 99; // never clears
      await exec('claudeAssets.deleteFile', file);
      assert.ok(fs.existsSync(file), 'file remains when the lock never clears');
      assert.strictEqual(harness.fsDeleteCalls, 4, 'should stop after the default 4 attempts');
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'error');
      assert.ok(/EPERM/.test(msg!.text), 'error should report the underlying EPERM');
    });

    it('does not retry a non-retryable delete error', async () => {
      const file = path.join(claudeDir, 'skills', 'gone.md');
      writeFile(file, 'x');
      harness.warningResponses.push('Delete');
      harness.fsDeleteErrorCode = 'EINVAL'; // not in the retryable set
      harness.fsDeleteFailuresRemaining = 99;
      await exec('claudeAssets.deleteFile', file);
      assert.strictEqual(harness.fsDeleteCalls, 1, 'a non-retryable error must fail fast');
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'error');
    });
  });

  // -------------------------------------------------------------------------
  // create Skill / Agent / Command.
  // -------------------------------------------------------------------------

  describe('asset creation commands', () => {
    it('createSkill writes <dir>/<name>/SKILL.md', async () => {
      const skillsDir = path.join(claudeDir, 'skills');
      harness.inputResponses.push('my-skill');
      await exec('claudeAssets.createSkill', { createTargetDir: skillsDir });
      const created = path.join(skillsDir, 'my-skill', 'SKILL.md');
      assert.ok(fs.existsSync(created), 'SKILL.md should be created');
      assert.ok(fs.readFileSync(created, 'utf8').includes('name: my-skill'));
    });

    it('createAgent writes <dir>/<name>.md', async () => {
      const agentsDir = path.join(claudeDir, 'agents');
      harness.inputResponses.push('my-agent');
      await exec('claudeAssets.createAgent', { createTargetDir: agentsDir });
      assert.ok(fs.existsSync(path.join(agentsDir, 'my-agent.md')), 'agent file should be created');
    });

    it('createCommand writes <dir>/<name>.md', async () => {
      const commandsDir = path.join(claudeDir, 'commands');
      harness.inputResponses.push('do-thing');
      await exec('claudeAssets.createCommand', { createTargetDir: commandsDir });
      assert.ok(fs.existsSync(path.join(commandsDir, 'do-thing.md')), 'command file should be created');
    });

    it('opens the new file after creating it', async () => {
      const skillsDir = path.join(claudeDir, 'skills');
      harness.inputResponses.push('opener');
      await exec('claudeAssets.createSkill', { createTargetDir: skillsDir });
      // handleCreate -> executeCommand('claudeAssets.openMarkdown', file) -> vscode.open built-in.
      assert.ok(
        harness.executed.some(e => e.command === 'vscode.open'),
        'creating an asset should open it (vscode.open recorded)'
      );
    });

    it('creates nothing when the name prompt is cancelled', async () => {
      const skillsDir = path.join(claudeDir, 'skills');
      harness.inputResponses.push(undefined); // user cancels
      await exec('claudeAssets.createSkill', { createTargetDir: skillsDir });
      assert.deepStrictEqual(fs.readdirSync(skillsDir), [], 'no asset should be written on cancel');
    });

    it('refuses to create inside the plugins tree', async () => {
      const pluginsDir = path.join(claudeDir, 'plugins', 'repos');
      mkdir(pluginsDir);
      harness.inputResponses.push('should-not-be-used');
      await exec('claudeAssets.createSkill', { createTargetDir: pluginsDir });
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'info');
      assert.ok(/managed by Claude/i.test(msg!.text));
      // The name prompt must not have been consumed.
      assert.strictEqual(harness.inputResponses.length, 1, 'name prompt should be skipped');
    });

    it('errors when the target dir cannot be determined', async () => {
      await exec('claudeAssets.createAgent', {}); // no createTargetDir
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'error');
      assert.ok(/target directory/i.test(msg!.text));
    });
  });

  // -------------------------------------------------------------------------
  // A few more wired commands.
  // -------------------------------------------------------------------------

  describe('other commands', () => {
    it('removeDirectory reports when there are no registered directories', async () => {
      await exec('claudeAssets.removeDirectory');
      const msg = lastMessage();
      assert.strictEqual(msg?.level, 'info');
      assert.ok(/no registered directories/i.test(msg!.text));
    });

    it('refresh runs a scan without surfacing an error', async () => {
      await exec('claudeAssets.refresh');
      assert.strictEqual(
        harness.messages.find(m => m.level === 'error'),
        undefined,
        'refresh should not raise an error message'
      );
    });

    it('showSectionInfo opens docs externally when "Open Docs" is chosen', async () => {
      harness.infoResponses.push('Open Docs');
      await exec('claudeAssets.showSectionInfo', { contextValue: 'assetGroupSkills' });
      assert.strictEqual(harness.openedExternal.length, 1, 'should open exactly one external doc URL');
      assert.ok(/^https?:\/\//.test(harness.openedExternal[0]), 'opened a URL');
    });

    it('showSectionInfo does nothing for a non-informational contextValue', async () => {
      await exec('claudeAssets.showSectionInfo', { contextValue: 'somethingElse' });
      assert.strictEqual(harness.messages.length, 0, 'no message for unknown section');
      assert.strictEqual(harness.openedExternal.length, 0);
    });
  });

  describe('context summary row', () => {
    it('leads the Global view with an always-loaded token summary after a scan', async () => {
      // Token display is off by default; enable it for this section.
      harness.config['claudeAssets.showTokenUsageGlobal'] = true;
      // A CLAUDE.md (always loaded in full) plus a skill (small upfront, larger body).
      writeFile(path.join(claudeDir, 'CLAUDE.md'), '# rules\n'.repeat(80));
      writeFile(
        path.join(claudeDir, 'skills', 's', 'SKILL.md'),
        `---\nname: s\ndescription: does s\n---\n${'body text '.repeat(200)}`
      );
      await exec('claudeAssets.refresh');
      const label = summaryLabel('claudeAssets.global') ?? '';
      // Summary uses the same compact "(a)" / "(d)" format as the rows.
      assert.ok(/\(a\)/.test(label), `summary should show the always (a) total: ${label}`);
      assert.ok(/tk/.test(label), `summary should use the tk unit: ${label}`);
      assert.ok(/\(d\)/.test(label), `summary should show the on-demand (d) total: ${label}`);
      assert.ok(!/%/.test(label), `summary must not show a percentage: ${label}`);
    });

    it('shows no summary row when there are no global assets', async () => {
      // Enabled, but beforeEach activated with empty .claude dirs -> nothing to count.
      harness.config['claudeAssets.showTokenUsageGlobal'] = true;
      await exec('claudeAssets.refresh');
      assert.strictEqual(summaryLabel('claudeAssets.global'), undefined);
    });

    it('shows no summary row when token display is off', async () => {
      writeFile(path.join(claudeDir, 'CLAUDE.md'), '# rules\n'.repeat(80));
      await exec('claudeAssets.refresh');
      assert.strictEqual(summaryLabel('claudeAssets.global'), undefined, 'off by default -> no summary row');
    });

    it('Working Directory summary excludes worktree copies (counted once, not double)', () => {
      // A main CLAUDE.md and an identical copy under .claude/worktrees/<name>/: the
      // worktree copy renders under a separate "worktrees" folder, so it must not
      // inflate the active-context banner.
      const root = '/ws/proj';
      const content = '# rules\n'.repeat(80);
      const mkClaudeMd = (filePath: string): ClaudeAsset => ({
        type: AssetType.ClaudeMd, name: 'CLAUDE.md', filePath,
        scope: AssetScope.Project, rootPath: root, description: undefined,
        tokenUsage: computeTokenUsage(AssetType.ClaudeMd, content)
      });
      const main = mkClaudeMd(path.join(root, 'CLAUDE.md'));
      const worktree = mkClaudeMd(path.join(root, '.claude', 'worktrees', 'agent-x', 'CLAUDE.md'));

      const provider = new AssetTreeProvider('working-directory');
      provider.update([main, worktree]);

      // Only the main copy counts -- not main + worktree.
      assert.deepStrictEqual(provider.getContextSummary(), main.tokenUsage);
    });
  });

  describe('worktree visibility toggle (Working Directory only)', () => {
    const root = '/ws/proj';
    const mkAgent = (filePath: string): ClaudeAsset => ({
      type: AssetType.Subagent, name: 'ops', filePath,
      scope: AssetScope.Project, description: undefined, rootPath: root,
      tokenUsage: computeTokenUsage(AssetType.Subagent, '---\nname: ops\ndescription: d\n---\nbody')
    });
    const main = mkAgent(path.join(root, '.claude', 'agents', 'ops.md'));
    const worktree = mkAgent(path.join(root, '.claude', 'worktrees', 'agent-x', '.claude', 'agents', 'ops.md'));

    const hasWorktreesFolder = (provider: AssetTreeProvider): boolean =>
      (provider.getChildren() as Array<{ label?: string }>).some(n => n.label === 'worktrees');

    it('hides the worktrees folder by default', () => {
      const provider = new AssetTreeProvider('working-directory');
      provider.update([main, worktree]);
      assert.strictEqual(hasWorktreesFolder(provider), false, 'worktrees folder hidden by default');
    });

    it('shows the worktrees folder once the toggle is enabled', () => {
      harness.config['claudeAssets.showWorktrees'] = true;
      const provider = new AssetTreeProvider('working-directory');
      provider.update([main, worktree]);
      assert.strictEqual(hasWorktreesFolder(provider), true, 'worktrees folder shown when enabled');
    });

    it('show/hide commands persist the setting and flip the title-bar context key', async () => {
      const lastWtContext = () =>
        [...harness.executed].reverse().find(e => e.command === 'setContext' && e.args[0] === 'claudeAssets.worktreesEnabled');

      await exec('claudeAssets.showWorktrees');
      assert.strictEqual(harness.config['claudeAssets.showWorktrees'], true, 'setting persisted on');
      assert.ok(lastWtContext()?.args[1] === true, 'context key set true');

      await exec('claudeAssets.hideWorktrees');
      assert.strictEqual(harness.config['claudeAssets.showWorktrees'], false, 'setting persisted off');
      assert.ok(lastWtContext()?.args[1] === false, 'context key set false');
    });
  });

  describe('token legend', () => {
    it('explains what (a) and (d) mean', async () => {
      await exec('claudeAssets.tokenLegend');
      const msg = lastMessage();
      assert.ok(msg, 'an information message was shown');
      assert.strictEqual(msg!.level, 'info');
      const detail = msg!.detail ?? '';
      assert.ok(/\(a\)/.test(detail) && /always loaded/i.test(detail), `detail explains (a): ${detail}`);
      assert.ok(/\(d\)/.test(detail) && /on demand/i.test(detail), `detail explains (d): ${detail}`);
    });
  });

  describe('token usage toggle (per-section)', () => {
    beforeEach(() => {
      writeFile(path.join(claudeDir, 'CLAUDE.md'), '# rules\n'.repeat(80));
    });

    const lastSetContext = (key: string) =>
      [...harness.executed].reverse().find(e => e.command === 'setContext' && e.args[0] === key);

    it('Global disable hides the Global summary row and persists only the Global setting', async () => {
      // Tokens are off by default; turn the Global section on so there is a summary to hide.
      await exec('claudeAssets.enableTokenUsageGlobal');
      assert.ok(summaryLabel('claudeAssets.global'), 'Global summary present when enabled');

      await exec('claudeAssets.disableTokenUsageGlobal');
      assert.strictEqual(harness.config['claudeAssets.showTokenUsageGlobal'], false, 'Global setting off');
      // Working Directory setting must be untouched by the Global command.
      assert.strictEqual(harness.config['claudeAssets.showTokenUsageWorkingDirectory'], undefined, 'WD setting untouched');
      assert.strictEqual(summaryLabel('claudeAssets.global'), undefined, 'Global summary hidden');

      await exec('claudeAssets.enableTokenUsageGlobal');
      assert.strictEqual(harness.config['claudeAssets.showTokenUsageGlobal'], true, 'Global setting on');
      assert.ok(summaryLabel('claudeAssets.global'), 'Global summary restored');
    });

    it('each section drives its own context key independently', async () => {
      await exec('claudeAssets.enableTokenUsageGlobal');
      await exec('claudeAssets.disableTokenUsageGlobal');
      const g = lastSetContext('claudeAssets.tokenUsageEnabledGlobal');
      assert.ok(g && g.args[1] === false, 'Global key set false');
      // The Working Directory key was set on activation (default off) and never touched
      // by the Global commands -- it retains its activation value, independent of Global.
      const w = lastSetContext('claudeAssets.tokenUsageEnabledWorkingDirectory');
      assert.ok(w && w.args[1] === false, 'WD key retains its activation value (independent)');
    });
  });

  describe('non-asset files show on-demand tokens', () => {
    it('a reference file in a skill folder gets an on-demand (d) count', () => {
      // Token display is off by default; enable it so the fs nodes carry token text.
      harness.config['claudeAssets.showTokenUsageGlobal'] = true;
      const skillsDir = path.join(claudeDir, 'skills');
      const skillDir = path.join(skillsDir, 'my-skill');
      const skillMd = path.join(skillDir, 'SKILL.md');
      writeFile(skillMd, '---\nname: my-skill\ndescription: does a thing\n---\nthe skill body');
      writeFile(path.join(skillDir, 'reference.md'), 'reference material '.repeat(80));

      const asset: ClaudeAsset = {
        type: AssetType.Skill, name: 'my-skill', filePath: skillMd,
        scope: AssetScope.Global, description: 'does a thing', rootPath: claudeDir,
        tokenUsage: computeTokenUsage(AssetType.Skill, fs.readFileSync(skillMd, 'utf8'))
      };
      const provider = new AssetTreeProvider('global');
      provider.update([asset]);

      const roots = provider.getChildren() as Array<{ assetType?: AssetType }>;
      const skillsGroup = roots.find(n => n.assetType === AssetType.Skill);
      assert.ok(skillsGroup, 'skills group present');
      const folders = provider.getChildren(skillsGroup as never) as Array<{ dirPath?: string }>;
      const myFolder = folders.find(n => n.dirPath === skillDir);
      assert.ok(myFolder, 'skill folder present');
      const files = provider.getChildren(myFolder as never) as Array<{ filePath?: string; description?: string }>;

      const ref = files.find(n => n.filePath?.endsWith('reference.md'));
      assert.ok(ref, 'reference.md listed');
      assert.ok(/\(d\)/.test(ref!.description ?? ''), `reference shows on-demand: ${ref!.description}`);
      assert.ok(!/\(a\)/.test(ref!.description ?? ''), 'reference has no always-loaded portion');

      const skillFile = files.find(n => n.filePath?.endsWith('SKILL.md'));
      assert.ok(/\(a\)/.test(skillFile!.description ?? ''), `SKILL.md shows always: ${skillFile!.description}`);
    });
  });

  describe('re-scan on save', () => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 220));

    it('recomputes token usage when a tracked file is saved', async () => {
      // Tokens are off by default; enable so the summary reflects the file's size.
      harness.config['claudeAssets.showTokenUsageGlobal'] = true;
      const claudeMd = path.join(claudeDir, 'CLAUDE.md');
      writeFile(claudeMd, '# rules\n');
      await exec('claudeAssets.refresh');
      const before = summaryLabel('claudeAssets.global');
      assert.ok(before, 'summary present after initial scan');

      // Grow the file on disk, then simulate the editor save event.
      writeFile(claudeMd, '# rules\n' + 'a lot more always-loaded content. '.repeat(500));
      fireDidSave(claudeMd);
      await settle();

      const after = summaryLabel('claudeAssets.global');
      assert.notStrictEqual(after, before, 'summary should change after the file grows and is saved');
      assert.ok(/k tk \(a\)/.test(after!), `always-loaded total should now be in the thousands: ${after}`);
    });

    it('ignores saves outside the tracked scan roots', async () => {
      harness.config['claudeAssets.showTokenUsageGlobal'] = true;
      writeFile(path.join(claudeDir, 'CLAUDE.md'), '# rules\n');
      await exec('claudeAssets.refresh');
      const before = summaryLabel('claudeAssets.global');

      fireDidSave(path.join(home, 'unrelated', 'file.md'));
      await settle();

      assert.strictEqual(summaryLabel('claudeAssets.global'), before, 'unrelated save must not change anything');
    });
  });
});
