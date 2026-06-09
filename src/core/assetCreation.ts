import * as fs from 'fs';
import * as path from 'path';
import { AssetType } from './types';

/**
 * Returns true when the given name is valid as an asset name.
 * Rules:
 *   - First char must be alphanumeric ([A-Za-z0-9]).
 *   - Remaining chars may be alphanumeric, dot, underscore, or dash.
 *   - Must not equal '.' or '..'.
 *   - Must not contain '/', '\', or the platform path separator.
 * Trim is NOT applied; validate as given.
 */
export function isValidAssetName(name: string): boolean {
  if (!name) return false;
  // Reject names containing any path separator (covers '/', '\', and platform sep).
  if (name.includes('/') || name.includes('\\') || name.includes(path.sep)) return false;
  // Pattern: first char alnum, rest alnum + . _ -
  const pattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!pattern.test(name)) return false;
  // Reject '.' and '..' (redundant with the leading-alnum rule but explicit).
  if (name === '.' || name === '..') return false;
  return true;
}

/**
 * Returns the template content for a new asset of the given type.
 * Throws for types that do not support templated creation.
 */
export function assetTemplate(type: AssetType, name: string): string {
  switch (type) {
    case AssetType.Skill:
      return [
        '---',
        `name: ${name}`,
        'description: <one-line summary of when to use this skill>',
        '---',
        '',
        '# Instructions',
        ''
      ].join('\n');

    case AssetType.Subagent:
      return [
        '---',
        `name: ${name}`,
        'description: <one-line summary of when this subagent should be used>',
        'model: inherit',
        '---',
        '',
        '# Instructions',
        ''
      ].join('\n');

    case AssetType.Command:
      return [
        '---',
        'description: <one-line summary of what this command does>',
        'argument-hint: <optional, e.g. [file]>',
        '---',
        '',
        '# Instructions',
        '',
        '<!-- Use $ARGUMENTS for invocation input. -->',
        ''
      ].join('\n');

    default:
      throw new Error(`Unsupported asset type for template: ${type}`);
  }
}

/**
 * Returns the file path relative to the segment directory for a new asset of the given type.
 *   Skill    -> <name>/SKILL.md
 *   Subagent -> <name>.md
 *   Command  -> <name>.md
 */
export function newAssetRelativePath(type: AssetType, name: string): string {
  if (type === AssetType.Skill) {
    return path.join(name, 'SKILL.md');
  }
  return name + '.md';
}

/**
 * Creates a new asset file at `<segmentDir>/<newAssetRelativePath(type, name)>`.
 * Parent directories are created as needed.
 *
 * Throws:
 *   - Error('Invalid asset name: <name>') when the name fails validation.
 *   - Error('...<path> already exists') when the target file already exists.
 *
 * Returns the absolute path of the created file.
 */
export function createAsset(type: AssetType, segmentDir: string, name: string): string {
  if (!isValidAssetName(name)) {
    throw new Error(`Invalid asset name: ${name}`);
  }
  const relativePath = newAssetRelativePath(type, name);
  const fullPath = path.join(segmentDir, relativePath);
  if (fs.existsSync(fullPath)) {
    throw new Error(`${fullPath} already exists`);
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, assetTemplate(type, name), 'utf8');
  return fullPath;
}
