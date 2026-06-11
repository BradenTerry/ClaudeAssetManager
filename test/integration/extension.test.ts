import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Importing the mock first installs the require('vscode') hook BEFORE the
// extension (and its vscode-coupled modules) are loaded below.
import { vscodeMock, harness, lastMessage } from './vscodeMock';
import { makeTempDir, writeFile, mkdir } from '../core/fixtures';

// Load the real extension through the hook. Required (not imported) so it
// resolves after the hook above is installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extension = require('../../src/extension') as { activate: (ctx: unknown) => void };

const exec = (command: string, ...args: unknown[]): Promise<unknown> =>
  vscodeMock.commands.executeCommand(command, ...args);

describe('extension integration', () => {
  let originalHome: string | undefined;
  let cleanup: () => void;
  let originalUserProfile: string | undefined;
  let home: string;
  let claudeDir: string;

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
});
