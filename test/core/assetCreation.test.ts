import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { AssetType } from '../../src/core/types';
import { isValidAssetName, assetTemplate, createAsset } from '../../src/core/assetCreation';
import { makeTempDir } from './fixtures';

// ---------------------------------------------------------------------------
// AC1: isValidAssetName
// ---------------------------------------------------------------------------

describe('isValidAssetName -- AC1', () => {
  it('accepts my-skill', () => {
    assert.strictEqual(isValidAssetName('my-skill'), true);
  });

  it('accepts Skill_1', () => {
    assert.strictEqual(isValidAssetName('Skill_1'), true);
  });

  it('accepts single char a', () => {
    assert.strictEqual(isValidAssetName('a'), true);
  });

  it('rejects empty string', () => {
    assert.strictEqual(isValidAssetName(''), false);
  });

  it('rejects name with space', () => {
    assert.strictEqual(isValidAssetName('a b'), false);
  });

  it('rejects name with forward slash', () => {
    assert.strictEqual(isValidAssetName('a/b'), false);
  });

  it('rejects name with backslash', () => {
    assert.strictEqual(isValidAssetName('a\\b'), false);
  });

  it('rejects .hidden (leading dot)', () => {
    assert.strictEqual(isValidAssetName('.hidden'), false);
  });

  it('rejects ..', () => {
    assert.strictEqual(isValidAssetName('..'), false);
  });

  it('rejects ../x (path traversal)', () => {
    assert.strictEqual(isValidAssetName('../x'), false);
  });

  it('rejects name with path separator', () => {
    assert.strictEqual(isValidAssetName('a' + path.sep + 'b'), false);
  });
});

// ---------------------------------------------------------------------------
// AC2: assetTemplate for Skill
// ---------------------------------------------------------------------------

describe('assetTemplate -- AC2 (Skill)', () => {
  it('contains name: foo', () => {
    const t = assetTemplate(AssetType.Skill, 'foo');
    assert.ok(t.includes('name: foo'), 'expected "name: foo" in skill template');
  });

  it('contains description placeholder line', () => {
    const t = assetTemplate(AssetType.Skill, 'foo');
    assert.ok(t.includes('description: <one-line summary'), 'expected description placeholder in skill template');
  });

  it('contains # Instructions heading', () => {
    const t = assetTemplate(AssetType.Skill, 'foo');
    assert.ok(t.includes('# Instructions'), 'expected "# Instructions" in skill template');
  });
});

// ---------------------------------------------------------------------------
// AC3: assetTemplate for Subagent and Command
// ---------------------------------------------------------------------------

describe('assetTemplate -- AC3 (Subagent)', () => {
  it('contains name: foo frontmatter', () => {
    const t = assetTemplate(AssetType.Subagent, 'foo');
    assert.ok(t.includes('name: foo'), 'expected "name: foo" in subagent template');
  });

  it('contains description: line', () => {
    const t = assetTemplate(AssetType.Subagent, 'foo');
    assert.ok(t.includes('description:'), 'expected "description:" in subagent template');
  });

  it('contains model: inherit line', () => {
    const t = assetTemplate(AssetType.Subagent, 'foo');
    assert.ok(t.includes('model: inherit'), 'expected "model: inherit" in subagent template');
  });
});

describe('assetTemplate -- AC3 (Command)', () => {
  it('contains description: line in frontmatter (no name: key)', () => {
    const t = assetTemplate(AssetType.Command, 'foo');
    assert.ok(t.includes('description:'), 'expected "description:" in command template');
    assert.ok(!t.includes('name:'), 'command template must not contain "name:" key');
  });

  it('body mentions $ARGUMENTS', () => {
    const t = assetTemplate(AssetType.Command, 'foo');
    assert.ok(t.includes('$ARGUMENTS'), 'expected "$ARGUMENTS" in command template body');
  });
});

describe('assetTemplate -- defensive (unsupported type)', () => {
  it('throws for Memory type', () => {
    assert.throws(() => assetTemplate(AssetType.Memory, 'foo'), /unsupported/i);
  });
});

// ---------------------------------------------------------------------------
// AC4: createAsset for Skill creates <segmentDir>/foo/SKILL.md
// ---------------------------------------------------------------------------

describe('createAsset -- AC4 (Skill, non-existing segmentDir)', () => {
  let cleanup: () => void;
  let segmentDir: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    segmentDir = path.join(tmp.root, 'skills');
  });

  afterEach(() => cleanup());

  it('creates <segmentDir>/foo/SKILL.md and returns its absolute path', () => {
    const result = createAsset(AssetType.Skill, segmentDir, 'foo');
    const expected = path.join(segmentDir, 'foo', 'SKILL.md');
    assert.strictEqual(result, expected);
    assert.ok(fs.existsSync(result), 'SKILL.md should exist on disk');
  });

  it('SKILL.md contains the skill template content', () => {
    createAsset(AssetType.Skill, segmentDir, 'foo');
    const content = fs.readFileSync(path.join(segmentDir, 'foo', 'SKILL.md'), 'utf8');
    assert.ok(content.includes('name: foo'), 'file should contain "name: foo"');
    assert.ok(content.includes('# Instructions'), 'file should contain "# Instructions"');
  });

  it('creates parent dirs when segmentDir does not yet exist', () => {
    // segmentDir itself does not exist at this point
    assert.ok(!fs.existsSync(segmentDir), 'segmentDir should not exist before createAsset');
    createAsset(AssetType.Skill, segmentDir, 'foo');
    assert.ok(fs.existsSync(path.join(segmentDir, 'foo', 'SKILL.md')), 'file should be created with all parent dirs');
  });
});

// ---------------------------------------------------------------------------
// AC5: createAsset for Subagent and Command
// ---------------------------------------------------------------------------

describe('createAsset -- AC5 (Subagent and Command)', () => {
  let cleanup: () => void;
  let root: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    root = tmp.root;
  });

  afterEach(() => cleanup());

  it('Subagent creates <segmentDir>/foo.md', () => {
    const segDir = path.join(root, 'agents');
    const result = createAsset(AssetType.Subagent, segDir, 'foo');
    const expected = path.join(segDir, 'foo.md');
    assert.strictEqual(result, expected);
    assert.ok(fs.existsSync(result), 'foo.md should exist on disk');
  });

  it('Command creates <segmentDir>/bar.md', () => {
    const segDir = path.join(root, 'commands');
    const result = createAsset(AssetType.Command, segDir, 'bar');
    const expected = path.join(segDir, 'bar.md');
    assert.strictEqual(result, expected);
    assert.ok(fs.existsSync(result), 'bar.md should exist on disk');
  });
});

// ---------------------------------------------------------------------------
// AC6: createAsset throws on existing file or invalid name
// ---------------------------------------------------------------------------

describe('createAsset -- AC6 (error cases)', () => {
  let cleanup: () => void;
  let segmentDir: string;

  beforeEach(() => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    segmentDir = path.join(tmp.root, 'skills');
    fs.mkdirSync(segmentDir, { recursive: true });
  });

  afterEach(() => cleanup());

  it('throws when target file already exists, no file written on second call', () => {
    createAsset(AssetType.Skill, segmentDir, 'foo');
    assert.throws(() => createAsset(AssetType.Skill, segmentDir, 'foo'), /already exists/i);
  });

  it('throws on invalid name (empty string), no file written', () => {
    assert.throws(() => createAsset(AssetType.Skill, segmentDir, ''), /invalid asset name/i);
  });

  it('throws on invalid name (has slash), no file written', () => {
    assert.throws(() => createAsset(AssetType.Skill, segmentDir, 'a/b'), /invalid asset name/i);
    // nothing should have been written
    assert.ok(!fs.existsSync(path.join(segmentDir, 'a')), 'no dir should be created for invalid name');
  });

  it('throws on invalid name (.hidden), no file written', () => {
    assert.throws(() => createAsset(AssetType.Skill, segmentDir, '.hidden'), /invalid asset name/i);
  });
});
