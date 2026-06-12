import * as assert from 'assert';
import {
  categoryOf, isDraggableSource, segmentForAssetType, planCopies, DragItem, DropTarget
} from '../../src/core/dragRules';
import { AssetType } from '../../src/core/types';

describe('dragRules -- categoryOf', () => {
  it('finds the type segment for a skill folder, agent file, and command file', () => {
    assert.strictEqual(categoryOf('/p/.claude/skills/my-skill'), 'skills');
    assert.strictEqual(categoryOf('/p/.claude/skills/my-skill/SKILL.md'), 'skills');
    assert.strictEqual(categoryOf('/p/.claude/agents/ops.md'), 'agents');
    assert.strictEqual(categoryOf('/p/.claude/commands/deploy.md'), 'commands');
  });

  it('returns undefined for paths not under a draggable type dir', () => {
    assert.strictEqual(categoryOf('/p/.claude/workflows/wf.js'), undefined);
    assert.strictEqual(categoryOf('/p/CLAUDE.md'), undefined);
    assert.strictEqual(categoryOf('/p/src/index.ts'), undefined);
  });

  it('uses the deepest type segment when nested', () => {
    assert.strictEqual(categoryOf('/p/.claude/skills/x/agents/y.md'), 'agents');
  });
});

describe('dragRules -- isDraggableSource', () => {
  it('is true for items under a type dir, false for the type dir itself', () => {
    assert.strictEqual(isDraggableSource('/p/.claude/skills/my-skill'), true);
    assert.strictEqual(isDraggableSource('/p/.claude/agents/ops.md'), true);
    assert.strictEqual(isDraggableSource('/p/.claude/skills'), false, 'the skills dir itself is not draggable');
    assert.strictEqual(isDraggableSource('/p/CLAUDE.md'), false);
  });
});

describe('dragRules -- segmentForAssetType', () => {
  it('maps draggable asset types and rejects others', () => {
    assert.strictEqual(segmentForAssetType(AssetType.Skill), 'skills');
    assert.strictEqual(segmentForAssetType(AssetType.Subagent), 'agents');
    assert.strictEqual(segmentForAssetType(AssetType.Command), 'commands');
    assert.strictEqual(segmentForAssetType(AssetType.Workflow), undefined);
    assert.strictEqual(segmentForAssetType(AssetType.ClaudeMd), undefined);
  });
});

describe('dragRules -- planCopies', () => {
  const skill: DragItem = { path: '/a/.claude/skills/my-skill', category: 'skills' };
  const agent: DragItem = { path: '/a/.claude/agents/ops.md', category: 'agents' };

  it('group target: matching category copies into the group dir, mismatch is rejected', () => {
    const target: DropTarget = { kind: 'group', dir: '/b/.claude/skills', segment: 'skills' };
    const { copies, rejected } = planCopies([skill, agent], target);
    assert.deepStrictEqual(copies, [{ src: '/a/.claude/skills/my-skill', dest: '/b/.claude/skills/my-skill' }]);
    assert.strictEqual(rejected.length, 1, 'the agent is rejected at a skills group');
    assert.match(rejected[0].reason, /agents can only be copied to a agents folder/);
  });

  it('container target: each item is routed under <dir>/.claude/<category>/', () => {
    const target: DropTarget = { kind: 'container', dir: '/proj' };
    const { copies, rejected } = planCopies([skill, agent], target);
    assert.strictEqual(rejected.length, 0);
    assert.deepStrictEqual(copies, [
      { src: '/a/.claude/skills/my-skill', dest: '/proj/.claude/skills/my-skill' },
      { src: '/a/.claude/agents/ops.md', dest: '/proj/.claude/agents/ops.md' }
    ]);
  });
});
