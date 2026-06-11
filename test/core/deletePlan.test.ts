import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { isInsidePluginsTree, planDelete, deleteConfirmDetail } from '../../src/core/deletePlan';
import { makeTempDir, writeFile, mkdir } from './fixtures';

// ---------------------------------------------------------------------------
// AC1: isInsidePluginsTree
// ---------------------------------------------------------------------------

describe('isInsidePluginsTree -- AC1', () => {
  const pluginsRoot = path.join('/home', 'u', '.claude', 'plugins');

  it('true for the plugins root itself', () => {
    assert.strictEqual(isInsidePluginsTree(pluginsRoot, pluginsRoot), true);
  });

  it('true for a path inside the plugins root', () => {
    const inside = path.join(pluginsRoot, 'cache', 'foo', 'SKILL.md');
    assert.strictEqual(isInsidePluginsTree(inside, pluginsRoot), true);
  });

  it('false for a sibling whose name starts with the plugins root string', () => {
    // "plugins-backup" shares a prefix with "plugins" but is NOT inside it.
    const sibling = pluginsRoot + '-backup';
    assert.strictEqual(isInsidePluginsTree(sibling, pluginsRoot), false);
  });

  it('false for an unrelated path', () => {
    const other = path.join('/home', 'u', '.claude', 'skills', 'foo');
    assert.strictEqual(isInsidePluginsTree(other, pluginsRoot), false);
  });

  it('false for the .claude dir one level above plugins', () => {
    const parent = path.join('/home', 'u', '.claude');
    assert.strictEqual(isInsidePluginsTree(parent, pluginsRoot), false);
  });
});

// ---------------------------------------------------------------------------
// AC2: planDelete refusals (no real fs needed for the early returns)
// ---------------------------------------------------------------------------

describe('planDelete -- AC2 (refusals)', () => {
  const pluginsRoot = path.join('/home', 'u', '.claude', 'plugins');

  it('refuses with no-path when targetPath is undefined', () => {
    const plan = planDelete(undefined, pluginsRoot);
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.refusal, 'no-path');
  });

  it('refuses with no-path when targetPath is empty string', () => {
    const plan = planDelete('', pluginsRoot);
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.refusal, 'no-path');
  });

  it('refuses with plugins-managed for the plugins root itself', () => {
    const plan = planDelete(pluginsRoot, pluginsRoot);
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.refusal, 'plugins-managed');
    assert.strictEqual(plan.targetPath, pluginsRoot);
  });

  it('refuses with plugins-managed for a path inside the plugins tree', () => {
    const inside = path.join(pluginsRoot, 'repos', 'x', 'agent.md');
    const plan = planDelete(inside, pluginsRoot);
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.refusal, 'plugins-managed');
  });

  it('refuses with not-found for a path that does not exist', () => {
    const ghost = path.join('/definitely', 'not', 'here', 'nope.md');
    const plan = planDelete(ghost, pluginsRoot);
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.refusal, 'not-found');
    assert.strictEqual(plan.targetPath, ghost);
  });

  it('plugins-managed guard wins even when the path does not exist on disk', () => {
    // A non-existent path inside the plugins tree must still be refused as
    // plugins-managed, never reaching the existence check.
    const insideGhost = path.join(pluginsRoot, 'gone.md');
    const plan = planDelete(insideGhost, pluginsRoot);
    assert.strictEqual(plan.refusal, 'plugins-managed');
  });
});

// ---------------------------------------------------------------------------
// AC3: planDelete success for real files and folders
// ---------------------------------------------------------------------------

describe('planDelete -- AC3 (success, real fs)', () => {
  let cleanup: () => void;
  let root: string;
  // A plugins root that no test target lives under, so the guard never fires.
  let pluginsRoot: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    root = tmp.root;
    pluginsRoot = path.join(root, '.claude', 'plugins');
    mkdir(pluginsRoot);
  });

  afterEach(() => cleanup());

  it('returns ok with kind=file for an existing file', () => {
    const file = path.join(root, 'skills', 'foo.md');
    writeFile(file, '# hi');
    const plan = planDelete(file, pluginsRoot);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.kind, 'file');
    assert.strictEqual(plan.name, 'foo.md');
    assert.strictEqual(plan.targetPath, file);
    assert.strictEqual(plan.refusal, undefined);
  });

  it('returns ok with kind=folder for an existing directory', () => {
    const dir = path.join(root, 'skills', 'my-skill');
    mkdir(dir);
    writeFile(path.join(dir, 'SKILL.md'), '# hi');
    const plan = planDelete(dir, pluginsRoot);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.kind, 'folder');
    assert.strictEqual(plan.name, 'my-skill');
    assert.strictEqual(plan.targetPath, dir);
  });

  it('name is the basename even for deeply nested targets', () => {
    const file = path.join(root, 'a', 'b', 'c', 'deep.md');
    writeFile(file, 'x');
    const plan = planDelete(file, pluginsRoot);
    assert.strictEqual(plan.name, 'deep.md');
  });
});

// ---------------------------------------------------------------------------
// AC4: deleteConfirmDetail
// ---------------------------------------------------------------------------

describe('deleteConfirmDetail -- AC4', () => {
  it('includes the target path and the trash notice', () => {
    const p = path.join('/x', 'y', 'z.md');
    const detail = deleteConfirmDetail(p);
    assert.ok(detail.includes(p), 'detail should include the target path');
    assert.ok(/moves it to the trash/i.test(detail), 'detail should mention the trash');
  });
});

// ---------------------------------------------------------------------------
// AC5: end-to-end -- a plan that is ok can actually be deleted from disk
// ---------------------------------------------------------------------------

describe('planDelete -- AC5 (plan drives a real deletion)', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    root = tmp.root;
  });

  afterEach(() => cleanup());

  it('an ok folder plan removes the whole tree when applied', () => {
    const pluginsRoot = path.join(root, 'plugins');
    const dir = path.join(root, 'agents', 'nested');
    writeFile(path.join(dir, 'a.md'), 'a');
    writeFile(path.join(dir, 'sub', 'b.md'), 'b');

    const plan = planDelete(dir, pluginsRoot);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.kind, 'folder');

    // Apply the plan the way the command does (recursive removal).
    fs.rmSync(plan.targetPath!, { recursive: true, force: true });
    assert.ok(!fs.existsSync(dir), 'folder should be gone after applying the plan');
  });
});
