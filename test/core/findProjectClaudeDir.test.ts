import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { findProjectClaudeDir } from '../../src/core/findProjectClaudeDir';
import { makeTempDir, mkdir } from './fixtures';

describe('findProjectClaudeDir', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns undefined for an empty list', () => {
    const result = findProjectClaudeDir([]);
    assert.strictEqual(result, undefined);
  });

  it('returns undefined when no dir has a .claude subdirectory', () => {
    const folder = path.join(root, 'folder1');
    mkdir(folder);
    const result = findProjectClaudeDir([folder]);
    assert.strictEqual(result, undefined);
  });

  it('returns the first dir whose .claude exists as a directory', () => {
    const folder = path.join(root, 'folder1');
    const claudeDir = path.join(folder, '.claude');
    mkdir(claudeDir);
    const result = findProjectClaudeDir([folder]);
    assert.ok(result);
    assert.strictEqual(result.projectDir, folder);
    assert.strictEqual(result.projectClaudeDir, claudeDir);
  });

  it('multi-root: folder[0] has no .claude, folder[1] does -- returns folder[1]', () => {
    const folder0 = path.join(root, 'folder0');
    const folder1 = path.join(root, 'folder1');
    mkdir(folder0); // no .claude here
    mkdir(path.join(folder1, '.claude'));

    const result = findProjectClaudeDir([folder0, folder1]);
    assert.ok(result, 'should find the owning folder');
    assert.strictEqual(result.projectDir, folder1);
    assert.strictEqual(result.projectClaudeDir, path.join(folder1, '.claude'));
  });

  it('a .claude that is a FILE (not a directory) does not qualify', () => {
    const folder = path.join(root, 'folder1');
    mkdir(folder);
    // Create .claude as a file, not a directory
    fs.writeFileSync(path.join(folder, '.claude'), 'not a dir');
    const result = findProjectClaudeDir([folder]);
    assert.strictEqual(result, undefined);
  });

  it('returns the first qualifying dir when multiple have .claude', () => {
    const folder0 = path.join(root, 'folder0');
    const folder1 = path.join(root, 'folder1');
    mkdir(path.join(folder0, '.claude'));
    mkdir(path.join(folder1, '.claude'));

    const result = findProjectClaudeDir([folder0, folder1]);
    assert.ok(result);
    assert.strictEqual(result.projectDir, folder0);
  });
});
