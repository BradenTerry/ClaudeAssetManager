import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
// Import the mock first so require('vscode') is hooked before the controller loads.
import { vscodeMock, harness } from './vscodeMock';
import { makeTempDir, writeFile } from '../core/fixtures';
import { AssetType } from '../../src/core/types';
import { NodeKind } from '../../src/tree/nodeDescriptors';
import { AssetDragAndDropController } from '../../src/tree/dragController';
import { GroupNode, FsDirNode, FsFileNode, ContainerNode } from '../../src/tree/nodes';

const MIME = 'application/vnd.code.claudeasset';

function skillsGroup(dir: string): GroupNode {
  return new GroupNode({ kind: NodeKind.Group, assetType: AssetType.Skill, label: 'skills', children: [], dirPath: dir });
}

// Drag `sources` and drop on `target`, returning after the async drop completes.
async function dragDrop(controller: AssetDragAndDropController, sources: unknown[], target: unknown): Promise<void> {
  const dt = new vscodeMock.DataTransfer();
  controller.handleDrag(sources as never, dt as never);
  await controller.handleDrop(target as never, dt as never);
}

describe('AssetDragAndDropController', () => {
  let cleanup: () => void;
  let root: string;
  const controller = new AssetDragAndDropController(async () => { /* no rescan in test */ });

  beforeEach(() => {
    const tmp = makeTempDir();
    root = tmp.root;
    cleanup = tmp.cleanup;
    harness.reset();
  });
  afterEach(() => cleanup());

  it('copies a whole skill folder into another location\'s skills dir', async () => {
    const srcSkill = path.join(root, 'a', '.claude', 'skills', 'my-skill');
    writeFile(path.join(srcSkill, 'SKILL.md'), '---\nname: my-skill\n---\nbody');
    writeFile(path.join(srcSkill, 'reference.md'), 'ref');
    const destDir = path.join(root, 'b', '.claude', 'skills');
    fs.mkdirSync(destDir, { recursive: true });

    await dragDrop(controller, [new FsDirNode(srcSkill, 'my-skill')], skillsGroup(destDir));

    assert.ok(fs.existsSync(path.join(destDir, 'my-skill', 'SKILL.md')), 'SKILL.md copied');
    assert.ok(fs.existsSync(path.join(destDir, 'my-skill', 'reference.md')), 'whole folder copied (reference too)');
  });

  it('copies into an empty project/added-directory folder, routing under .claude/<category>', async () => {
    const srcSkill = path.join(root, 'a', '.claude', 'skills', 'my-skill');
    writeFile(path.join(srcSkill, 'SKILL.md'), 'body');
    const projDir = path.join(root, 'empty-proj');
    fs.mkdirSync(projDir, { recursive: true });
    const container = new ContainerNode({ kind: NodeKind.Container, containerKind: 'project', label: 'empty-proj', children: [], dirPath: projDir });

    await dragDrop(controller, [new FsDirNode(srcSkill, 'my-skill')], container);

    assert.ok(
      fs.existsSync(path.join(projDir, '.claude', 'skills', 'my-skill', 'SKILL.md')),
      'skill copied under <dir>/.claude/skills/ for a container drop'
    );
  });

  it('rejects an agent dropped on a skills group (type-constrained)', async () => {
    const agent = path.join(root, 'a', '.claude', 'agents', 'ops.md');
    writeFile(agent, 'agent');
    const destDir = path.join(root, 'b', '.claude', 'skills');
    fs.mkdirSync(destDir, { recursive: true });

    await dragDrop(controller, [new FsFileNode(agent, 'ops.md')], skillsGroup(destDir));

    assert.ok(!fs.existsSync(path.join(destDir, 'ops.md')), 'agent must not land in a skills folder');
    assert.ok(harness.messages.some(m => m.level === 'warn'), 'a warning is shown for the rejected drop');
  });

  it('prompts before overwriting and skips when not confirmed', async () => {
    const srcSkill = path.join(root, 'a', '.claude', 'skills', 'dup');
    writeFile(path.join(srcSkill, 'SKILL.md'), 'NEW');
    const destDir = path.join(root, 'b', '.claude', 'skills');
    writeFile(path.join(destDir, 'dup', 'SKILL.md'), 'OLD');

    // No warning response queued -> defaults to cancel -> skip, keep OLD.
    await dragDrop(controller, [new FsDirNode(srcSkill, 'dup')], skillsGroup(destDir));
    assert.strictEqual(fs.readFileSync(path.join(destDir, 'dup', 'SKILL.md'), 'utf8'), 'OLD', 'not overwritten when cancelled');

    // Confirm overwrite -> replaced with NEW.
    harness.warningResponses.push('Overwrite');
    await dragDrop(controller, [new FsDirNode(srcSkill, 'dup')], skillsGroup(destDir));
    assert.strictEqual(fs.readFileSync(path.join(destDir, 'dup', 'SKILL.md'), 'utf8'), 'NEW', 'overwritten when confirmed');
  });
});
