import { AssetType } from './types';

/**
 * Human-readable explanation for a top-level asset section (Skills, Agents,
 * Commands, Memory, Plugins). Surfaced via the inline info button on each
 * section header and as the section node's hover tooltip.
 */
export interface SectionInfo {
  /** Short title shown as the message heading, e.g. "Skills". */
  title: string;
  /** One-paragraph plain-text explanation of what the section is for. */
  summary: string;
  /** Canonical Claude Code docs page for this concept. */
  docUrl: string;
}

const SKILLS: SectionInfo = {
  title: 'Skills',
  summary:
    'Skills extend what Claude can do. Each skill is a folder with a SKILL.md file of '
    + 'instructions that loads only when needed. Claude uses a skill automatically when it is '
    + 'relevant, or you invoke it directly with /skill-name. They live in a skills/ directory '
    + '(~/.claude/skills globally, .claude/skills in a project).',
  docUrl: 'https://code.claude.com/docs/en/skills'
};

const AGENTS: SectionInfo = {
  title: 'Agents',
  summary:
    'Subagents are separate Claude workers, each with its own prompt, tool access, and model. '
    + 'Claude delegates a focused task to one to keep the main conversation\'s context clean. '
    + 'They are defined as markdown files in an agents/ directory (~/.claude/agents globally, '
    + '.claude/agents in a project) and listed in-session with /agents.',
  docUrl: 'https://code.claude.com/docs/en/sub-agents'
};

const COMMANDS: SectionInfo = {
  title: 'Commands',
  summary:
    'Slash commands are reusable prompts you trigger with /name. Each is a markdown file in a '
    + 'commands/ directory. Custom commands have been merged into skills: a commands/deploy.md '
    + 'file and a skills/deploy/SKILL.md folder both create /deploy and work the same way, so '
    + 'existing commands/ files keep working.',
  docUrl: 'https://code.claude.com/docs/en/slash-commands'
};

const WORKFLOWS: SectionInfo = {
  title: 'Workflows',
  summary:
    'Dynamic workflows are JavaScript scripts that orchestrate many subagents at scale, for '
    + 'tasks too big for one conversation such as codebase-wide audits, large migrations, and '
    + 'cross-checked research. Claude writes one for a task and you save it to a workflows/ '
    + 'directory (~/.claude/workflows globally, .claude/workflows in a project), where it becomes '
    + 'a /name command you can rerun. This section lists saved workflows read-only.',
  docUrl: 'https://code.claude.com/docs/en/workflows'
};

const MEMORY: SectionInfo = {
  title: 'Memory',
  summary:
    'Memory is how Claude carries context across sessions. CLAUDE.md files hold instructions you '
    + 'write; auto memory holds notes Claude writes itself, stored per project under '
    + '~/.claude/projects/<project>/memory/. Both are loaded at the start of every session.',
  docUrl: 'https://code.claude.com/docs/en/memory'
};

const PLUGINS: SectionInfo = {
  title: 'Plugins',
  summary:
    'Plugins are shareable, versioned bundles that add skills, agents, commands, hooks, and MCP '
    + 'servers together. You install them from marketplaces and toggle them on or off per scope. '
    + 'Global (user) plugins live under ~/.claude/plugins; project plugins are enabled in a '
    + 'project\'s .claude/settings.json. Use Manage Plugins to browse and install.',
  docUrl: 'https://code.claude.com/docs/en/plugins'
};

/** Maps each grouped asset type to its section explanation. */
const BY_ASSET_TYPE: Partial<Record<AssetType, SectionInfo>> = {
  [AssetType.Skill]: SKILLS,
  [AssetType.Subagent]: AGENTS,
  [AssetType.Command]: COMMANDS,
  [AssetType.Workflow]: WORKFLOWS,
  [AssetType.Memory]: MEMORY
};

/**
 * Maps a tree node contextValue to its section explanation. Covers the grouped
 * asset headers and the plugins roots (global and working-directory variants).
 * Returns undefined for contextValues that are not informational sections.
 */
export function getSectionInfoByContextValue(contextValue: string | undefined): SectionInfo | undefined {
  switch (contextValue) {
    case 'assetGroupSkills':
      return SKILLS;
    case 'assetGroupAgents':
      return AGENTS;
    case 'assetGroupCommands':
      return COMMANDS;
    case 'assetGroupWorkflows':
      return WORKFLOWS;
    case 'assetGroupMemory':
      return MEMORY;
    case 'assetPluginsRoot':
    case 'assetPluginsRootOutdated':
    case 'assetProjectPluginsRoot':
      return PLUGINS;
    default:
      return undefined;
  }
}

/** Returns the section explanation for a grouped asset type, when one exists. */
export function getSectionInfoByAssetType(type: AssetType): SectionInfo | undefined {
  return BY_ASSET_TYPE[type];
}
