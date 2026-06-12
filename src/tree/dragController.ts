import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  categoryOf, isDraggableSource, segmentForAssetType,
  planCopies, DRAGGABLE_SEGMENTS, DragItem, DragCategory, DropTarget
} from '../core/dragRules';
import { TreeNode, GroupNode, FsDirNode, FsFileNode, AssetNode, ContainerNode } from './nodes';

const MIME = 'application/vnd.code.claudeasset';
const PLUGINS_ROOT = path.join(os.homedir(), '.claude', 'plugins');

/** Absolute path of a node if it is a draggable file/folder, else undefined. */
function sourcePath(node: TreeNode): string | undefined {
  if (node instanceof FsDirNode) return node.dirPath;
  if (node instanceof FsFileNode) return node.filePath;
  if (node instanceof AssetNode) return node.filePath;
  return undefined;
}

/** Resolve which destination a drop landed on, or undefined when it is not a valid target. */
function resolveTarget(target: TreeNode | undefined): DropTarget | undefined {
  if (!target) return undefined;
  if (target instanceof GroupNode) {
    const segment = segmentForAssetType(target.assetType);
    const dir = target.dirPath ?? target.createTargetDir;
    if (!segment || !dir) return undefined;
    return { kind: 'group', dir, segment };
  }
  if (target instanceof FsDirNode) {
    // Dropping onto a type dir itself (e.g. a "skills" folder rendered from disk).
    const base = path.basename(target.dirPath);
    if ((DRAGGABLE_SEGMENTS as readonly string[]).includes(base)) {
      return { kind: 'group', dir: target.dirPath, segment: base as DragCategory };
    }
    return undefined;
  }
  if (target instanceof ContainerNode) {
    const dir = target.resourceUri?.fsPath;
    if (!dir) return undefined;
    return { kind: 'container', dir };
  }
  return undefined;
}

function underPlugins(p: string): boolean {
  return p === PLUGINS_ROOT || p.startsWith(PLUGINS_ROOT + path.sep);
}

/** True when dest is inside src (copying a folder into its own subtree). */
function isInside(src: string, dest: string): boolean {
  const s = path.resolve(src) + path.sep;
  return path.resolve(dest).startsWith(s);
}

/**
 * Drag-and-drop controller shared by all three section views. Copies (never moves) asset
 * files and whole folders (e.g. a full skill) between Global, Working Directory, and Added
 * Directories, constrained so a category only lands in the matching category. Prompts before
 * overwriting an existing destination.
 */
export class AssetDragAndDropController implements vscode.TreeDragAndDropController<TreeNode> {
  readonly dragMimeTypes = [MIME];
  readonly dropMimeTypes = [MIME];

  constructor(private readonly refresh: () => Promise<void>) {}

  handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const items: DragItem[] = [];
    for (const node of source) {
      const p = sourcePath(node);
      if (!p || !isDraggableSource(p)) continue;
      const category = categoryOf(p);
      if (!category) continue;
      items.push({ path: p, category });
    }
    if (items.length > 0) {
      dataTransfer.set(MIME, new vscode.DataTransferItem(JSON.stringify(items)));
    }
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const transferItem = dataTransfer.get(MIME);
    if (!transferItem) return;

    let items: DragItem[];
    try {
      items = JSON.parse(await transferItem.asString()) as DragItem[];
    } catch {
      return;
    }
    if (!items || items.length === 0) return;

    const dropTarget = resolveTarget(target);
    if (!dropTarget) {
      vscode.window.showWarningMessage('Drop onto a Skills, Agents, or Commands folder, or onto a project / added directory.');
      return;
    }

    const { copies, rejected } = planCopies(items, dropTarget);

    if (copies.length === 0) {
      const reason = rejected[0]?.reason ?? 'Nothing to copy here.';
      vscode.window.showWarningMessage(reason);
      return;
    }

    let copied = 0;
    let skipped = 0;
    for (const c of copies) {
      const src = path.resolve(c.src);
      const dest = path.resolve(c.dest);

      if (src === dest || isInside(src, dest)) { skipped++; continue; }
      if (underPlugins(dest)) {
        vscode.window.showInformationMessage('Plugin files are managed by Claude and cannot be copied into.');
        skipped++;
        continue;
      }

      if (fs.existsSync(dest)) {
        const pick = await vscode.window.showWarningMessage(
          `"${path.basename(dest)}" already exists in ${path.basename(path.dirname(dest))}. Overwrite?`,
          { modal: true }, 'Overwrite'
        );
        if (pick !== 'Overwrite') { skipped++; continue; }
        try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* fall through to copy */ }
      }

      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
        copied++;
      } catch (err) {
        vscode.window.showErrorMessage(`Could not copy ${path.basename(src)}: ${err}`);
      }
    }

    if (copied > 0) await this.refresh();

    const notes: string[] = [];
    if (copied > 0) notes.push(`Copied ${copied} item${copied === 1 ? '' : 's'}`);
    if (skipped > 0) notes.push(`${skipped} skipped`);
    if (rejected.length > 0) notes.push(`${rejected.length} not allowed here`);
    if (notes.length > 0) vscode.window.showInformationMessage(notes.join(' · '));
  }
}
