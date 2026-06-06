export enum AssetType {
  Skill = 'Skill',
  Subagent = 'Subagent',
  Command = 'Command',
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
}
