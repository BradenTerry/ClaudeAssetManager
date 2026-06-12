import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  categoryOf, isDraggableSource, segmentForAssetType,
  planCopies, DRAGGABLE_SEGMENTS, DragItem, DragCategory, DropTarget
} from '../core/dragRules';
import { TreeNode, GroupNode, FsDirNode, ContainerNode } from './nodes';

const MIME = 'application/vnd.claudeassets.drag';
const TREE_MIME_PREFIX = 'application/vnd.code.tree.';
const PLUGINS_ROOT = path.join(os.homedir(), '.claude', 'plugins');

// VS Code adds a per-view data-transfer item under application/vnd.code.tree.<view id> whose value
// is the dragged node objects. Declaring these (both casings, since VS Code may lowercase) makes
// cross-view drops fire handleDrop even when the custom mime is not carried across trees.
const VIEW_IDS = ['claudeAssets.global', 'claudeAssets.workingDirectory', 'claudeAssets.addedDirectories'];
const TREE_MIMES = VIEW_IDS.flatMap(id => [`${TREE_MIME_PREFIX}${id.toLowerCase()}`, `${TREE_MIME_PREFIX}${id}`]);

/**
 * Absolute path of a node if it carries one. Duck-typed (not instanceof) so it also works on the
 * node objects recovered from VS Code's tree mime, where the prototype may not survive.
 */
function sourcePath(node: unknown): string | undefined {
  const n = node as { dirPath?: unknown; filePath?: unknown; resourceUri?: { fsPath?: unknown } } | undefined;
  if (n && typeof n.dirPath === 'string') return n.dirPath;
  if (n && typeof n.filePath === 'string') return n.filePath;
  if (n && n.resourceUri && typeof n.resourceUri.fsPath === 'string') return n.resourceUri.fsPath;
  return undefined;
}

/** Build the draggable items from a set of source nodes. */
function nodesToItems(nodes: readonly unknown[]): DragItem[] {
  const items: DragItem[] = [];
  for (const node of nodes) {
    const p = sourcePath(node);
    if (!p || !isDraggableSource(p)) continue;
    const category = categoryOf(p);
    if (!category) continue;
    items.push({ path: p, category });
  }
  return items;
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
    // A type dir itself (e.g. a "skills" folder rendered from disk) is a group target.
    const base = path.basename(target.dirPath);
    if ((DRAGGABLE_SEGMENTS as readonly string[]).includes(base)) {
      return { kind: 'group', dir: target.dirPath, segment: base as DragCategory };
    }
    // A directory that is NOT inside a type tree is a project-like container; route under
    // its .claude/<category>/. A folder inside a type tree (e.g. a specific skill) is not a target.
    if (categoryOf(target.dirPath) === undefined) {
      return { kind: 'container', dir: target.dirPath };
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
  readonly dropMimeTypes = [MIME, ...TREE_MIMES];

  constructor(private readonly refresh: () => Promise<void>) {}

  handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const items = nodesToItems(source);
    if (items.length > 0) {
      dataTransfer.set(MIME, new vscode.DataTransferItem(JSON.stringify(items)));
    }
  }

  /**
   * Recover the dragged items from the custom mime, or from any VS Code tree mime present (scanned
   * by prefix so the exact view-id casing does not matter). `sawData` reports whether any candidate
   * drag payload was present at all, to distinguish a failed read from an unrelated drop.
   */
  private async readItems(dataTransfer: vscode.DataTransfer): Promise<{ items: DragItem[]; mimes: string[] }> {
    const mimes: string[] = [];
    dataTransfer.forEach((_item: vscode.DataTransferItem, mime: string) => { mimes.push(mime); });

    const custom = dataTransfer.get(MIME);
    if (custom) {
      try {
        const parsed = JSON.parse(await custom.asString()) as DragItem[];
        if (parsed && parsed.length > 0) return { items: parsed, mimes };
      } catch { /* fall through to tree mimes */ }
    }

    // Try every tree mime: its value may be the node objects, or a JSON string of them.
    let found: DragItem[] = [];
    for (const mime of mimes) {
      if (found.length > 0 || !mime.startsWith(TREE_MIME_PREFIX)) continue;
      const item = dataTransfer.get(mime);
      const value = (item as { value?: unknown } | undefined)?.value;
      let nodes: unknown[] | undefined;
      if (Array.isArray(value)) {
        nodes = value;
      } else {
        try {
          const parsed = JSON.parse(await item!.asString());
          if (Array.isArray(parsed)) nodes = parsed;
        } catch { /* not JSON */ }
      }
      if (nodes) {
        const items = nodesToItems(nodes);
        if (items.length > 0) found = items;
      }
    }
    return { items: found, mimes };
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const { items, mimes } = await this.readItems(dataTransfer);
    if (items.length === 0) {
      if (mimes.length > 0) {
        vscode.window.showWarningMessage(`Could not read the dragged item. Drag data types: ${mimes.join(', ')}`);
      }
      return;
    }

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
