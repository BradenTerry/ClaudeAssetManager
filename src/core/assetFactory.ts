import * as path from 'path';
import { AssetType, AssetScope, ClaudeAsset } from './types';
import { parseFrontmatter } from './frontmatter';
import * as fs from 'fs';

/**
 * Determine the AssetType for a given file path, or undefined if unrecognized.
 */
export function recognizeAssetType(filePath: string): AssetType | undefined {
  const basename = path.basename(filePath);
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Config files -- only the Claude ones, i.e. directly inside a .claude/ directory.
  // This excludes unrelated files like a project's .vscode/settings.json.
  const parentDir = path.basename(path.dirname(normalizedPath));
  if (
    parentDir === '.claude' &&
    (
      basename === 'settings.json' ||
      basename === 'settings.local.json' ||
      basename === 'keybindings.json'
    )
  ) {
    return AssetType.Config;
  }

  // CLAUDE.md
  if (basename === 'CLAUDE.md') {
    return AssetType.ClaudeMd;
  }

  // SKILL.md -- must be under a skills/ dir
  if (basename === 'SKILL.md' && normalizedPath.includes('/skills/')) {
    return AssetType.Skill;
  }

  // Memory files: MEMORY.md or *.md under a memory/ dir
  if (normalizedPath.includes('/memory/') && basename.endsWith('.md')) {
    return AssetType.Memory;
  }

  // Agent files: *.md under an agents/ dir
  if (normalizedPath.includes('/agents/') && basename.endsWith('.md')) {
    return AssetType.Subagent;
  }

  // Command files: *.md under a commands/ dir
  if (normalizedPath.includes('/commands/') && basename.endsWith('.md')) {
    return AssetType.Command;
  }

  // Workflow files: JavaScript scripts under a workflows/ dir (saved dynamic workflows).
  if (
    normalizedPath.includes('/workflows/') &&
    (basename.endsWith('.js') || basename.endsWith('.mjs') || basename.endsWith('.cjs'))
  ) {
    return AssetType.Workflow;
  }

  return undefined;
}

/**
 * Derive the asset name from its file path and type.
 * - Skill:   enclosing directory name (the skill's named folder)
 * - Subagent: filename without extension
 * - Command: subpath under commands/ without extension (for namespacing)
 * - ClaudeMd: "CLAUDE.md"
 * - Memory: filename without extension
 * - Config: filename
 */
export function deriveAssetName(filePath: string, type: AssetType): string {
  const normalizedPath = filePath.replace(/\\/g, '/');

  switch (type) {
    case AssetType.Skill: {
      // skills/<name>/SKILL.md  -> name is parent dir
      return path.basename(path.dirname(filePath));
    }
    case AssetType.Subagent: {
      return path.basename(filePath, '.md');
    }
    case AssetType.Command: {
      // commands/<sub/path/name>.md -> namespaced name = subpath without extension
      const commandsIdx = normalizedPath.lastIndexOf('/commands/');
      if (commandsIdx !== -1) {
        const relative = normalizedPath.slice(commandsIdx + '/commands/'.length);
        return relative.replace(/\.md$/, '');
      }
      return path.basename(filePath, '.md');
    }
    case AssetType.Workflow: {
      // workflows/<sub/path/name>.js -> namespaced name = subpath without extension
      const workflowsIdx = normalizedPath.lastIndexOf('/workflows/');
      if (workflowsIdx !== -1) {
        const relative = normalizedPath.slice(workflowsIdx + '/workflows/'.length);
        return relative.replace(/\.(js|mjs|cjs)$/, '');
      }
      return path.basename(filePath).replace(/\.(js|mjs|cjs)$/, '');
    }
    case AssetType.ClaudeMd: {
      return 'CLAUDE.md';
    }
    case AssetType.Memory: {
      const base = path.basename(filePath, '.md');
      return base === 'MEMORY' ? 'MEMORY.md' : path.basename(filePath);
    }
    case AssetType.Config: {
      return path.basename(filePath);
    }
  }
}

/**
 * Parse a frontmatter tools value into a string array.
 * Handles both a YAML list (string[]) and a comma-separated string.
 */
function parseToolsList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map(v => v.trim())
      .filter(v => v.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
  }
  return undefined;
}

/**
 * Build a ClaudeAsset from a file path, its type, scope, and the scan root path.
 */
export function buildAsset(filePath: string, type: AssetType, scope: AssetScope, rootPath: string = ''): ClaudeAsset {
  const name = deriveAssetName(filePath, type);
  let description: string | undefined;
  let tools: string[] | undefined;
  let frontmatter: Record<string, unknown> = {};

  if (type !== AssetType.Config) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const result = parseFrontmatter(content);
      frontmatter = result.data;
      if (typeof frontmatter['description'] === 'string') {
        description = frontmatter['description'];
      }
      // Parse tools from either 'tools' or 'allowed-tools' field
      const rawTools = frontmatter['tools'] ?? frontmatter['allowed-tools'];
      tools = parseToolsList(rawTools);
    } catch {
      // unreadable file -- proceed with no frontmatter
    }
  }

  return { type, name, filePath, scope, description, rootPath, tools, frontmatter };
}
