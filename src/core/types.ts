export enum AssetType {
  Skill = 'Skill',
  Subagent = 'Subagent',
  Command = 'Command',
  Workflow = 'Workflow',
  ClaudeMd = 'ClaudeMd',
  Memory = 'Memory',
  Config = 'Config'
}

export enum AssetScope {
  Global = 'global',
  Plugin = 'plugin',
  Project = 'project',
  Registered = 'registered'
}

/**
 * Token usage for a single asset, split by when it reaches the model.
 *   - upfront: tokens in context before any tool call (skill/agent name+description,
 *     or the full text of always-loaded CLAUDE.md / memory).
 *   - rest: tokens loaded only on demand (a body when invoked, a workflow when run).
 *   - total: upfront + rest.
 */
export interface TokenUsage {
  upfront: number;
  rest: number;
  total: number;
}

export interface ClaudeAsset {
  type: AssetType;
  name: string;
  filePath: string;
  scope: AssetScope;
  description: string | undefined;
  /** The ScanRoot.path this asset was discovered under */
  rootPath: string;
  /** Parsed tools list from frontmatter tools or allowed-tools field */
  tools?: string[];
  /** Parsed YAML frontmatter data (may be empty) */
  frontmatter?: Record<string, unknown>;
  /** Estimated upfront/rest token usage (undefined for Config and unreadable files) */
  tokenUsage?: TokenUsage;
}

export interface ScanRoot {
  path: string;
  scope: AssetScope;
  /** True if this root represents the global ~/.claude dir itself */
  isGlobal?: boolean;
  /** True if this root is the plugins sub-tree */
  isPlugins?: boolean;
  /** True if this root is the projects memory sub-tree */
  isMemory?: boolean;
}

export interface ScanOptions {
  excludeDirs: string[];
  followSymlinks: boolean;
  /** Max non-.claude directory depth to search before giving up. undefined = unlimited. */
  maxDepth?: number;
}
