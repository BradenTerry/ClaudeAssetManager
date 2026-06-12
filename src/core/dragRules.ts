import * as path from 'path';
import { AssetType } from './types';

/**
 * Asset categories that can be drag-copied between the Global, Working Directory, and
 * Added Directories sections. A dragged item may only land in the matching category
 * (a skill -> skills, an agent -> agents, a command -> commands), so e.g. a whole skill
 * folder copied to another project goes under that project's skills/.
 */
export const DRAGGABLE_SEGMENTS = ['skills', 'agents', 'commands'] as const;
export type DragCategory = typeof DRAGGABLE_SEGMENTS[number];

function isCategory(s: string): s is DragCategory {
  return (DRAGGABLE_SEGMENTS as readonly string[]).includes(s);
}

/**
 * The asset category a path belongs to: the deepest path segment that is a draggable
 * type dir (skills/agents/commands). Returns undefined when the path is not under one.
 */
export function categoryOf(filePath: string): DragCategory | undefined {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    if (isCategory(seg)) return seg;
  }
  return undefined;
}

/** True when a path is a draggable source: under a type dir, but not the type dir itself. */
export function isDraggableSource(filePath: string): boolean {
  const cat = categoryOf(filePath);
  if (!cat) return false;
  return path.basename(filePath.replace(/[\\/]+$/, '')) !== cat;
}

/** The destination category dir for an asset type, or undefined for non-draggable types. */
export function segmentForAssetType(type: AssetType): DragCategory | undefined {
  switch (type) {
    case AssetType.Skill: return 'skills';
    case AssetType.Subagent: return 'agents';
    case AssetType.Command: return 'commands';
    default: return undefined;
  }
}

export interface DragItem {
  /** Absolute path of the dragged file or folder. */
  path: string;
  category: DragCategory;
}

/**
 * Where a drop landed:
 *  - 'group': a type-group folder (skills/agents/commands). `dir` is that folder; only
 *    items of `segment` are accepted.
 *  - 'container': a project / added-directory folder. `dir` is its root; each item is
 *    routed to `<dir>/.claude/<category>/`.
 */
export type DropTarget =
  | { kind: 'group'; dir: string; segment: DragCategory }
  | { kind: 'container'; dir: string };

export interface PlannedCopy {
  src: string;
  dest: string;
}

export interface RejectedItem {
  path: string;
  reason: string;
}

/**
 * Pure planning: map dragged items to their destination paths for a drop target, and
 * collect the ones rejected because their category does not match a group target.
 * No filesystem access -- existence/overwrite is handled by the caller.
 */
export function planCopies(items: DragItem[], target: DropTarget): { copies: PlannedCopy[]; rejected: RejectedItem[] } {
  const copies: PlannedCopy[] = [];
  const rejected: RejectedItem[] = [];
  for (const item of items) {
    const name = path.basename(item.path.replace(/[\\/]+$/, ''));
    if (target.kind === 'group') {
      if (item.category !== target.segment) {
        rejected.push({ path: item.path, reason: `${item.category} can only be copied to a ${item.category} folder` });
        continue;
      }
      copies.push({ src: item.path, dest: path.join(target.dir, name) });
    } else {
      copies.push({ src: item.path, dest: path.join(target.dir, '.claude', item.category, name) });
    }
  }
  return { copies, rejected };
}
