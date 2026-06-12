import { AssetType, TokenUsage } from './types';
import { parseFrontmatter } from './frontmatter';

export const ZERO_USAGE: TokenUsage = { upfront: 0, rest: 0, total: 0 };

/**
 * Estimate the token count of a string. This is a local heuristic (~4 chars per
 * token, the common rule of thumb for English/markdown), not the exact Claude
 * tokenizer -- the real count needs the count-tokens API. Display it with a "~".
 */
export function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.ceil(trimmed.length / 4);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Compute the upfront/rest token split for an asset from its raw file content.
 * Pure: parses frontmatter itself so it is testable from a content string alone.
 */
export function computeTokenUsage(type: AssetType, content: string): TokenUsage {
  const { data, body } = parseFrontmatter(content);

  let upfront: number;
  let rest: number;

  switch (type) {
    case AssetType.Skill:
    case AssetType.Subagent: {
      // Only the name + description load upfront; the body loads when invoked.
      const meta = [str(data['name']), str(data['description'])].filter(Boolean).join('\n');
      upfront = estimateTokens(meta);
      rest = estimateTokens(body);
      break;
    }
    case AssetType.Command: {
      // Commands have no name field (name comes from the filename); the description
      // is the only part surfaced before invocation, the body loads when run.
      upfront = estimateTokens(str(data['description']));
      rest = estimateTokens(body);
      break;
    }
    case AssetType.ClaudeMd:
    case AssetType.Memory: {
      // Always injected in full on every turn.
      upfront = estimateTokens(content);
      rest = 0;
      break;
    }
    case AssetType.Workflow: {
      // Not auto-loaded into context; only read when the workflow runs.
      upfront = 0;
      rest = estimateTokens(content);
      break;
    }
    case AssetType.Config:
    default: {
      // Config (settings.json etc.) is read by the CLI, never injected as context.
      upfront = 0;
      rest = 0;
      break;
    }
  }

  return { upfront, rest, total: upfront + rest };
}

/** Sum two usages (used for group totals). */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    upfront: a.upfront + b.upfront,
    rest: a.rest + b.rest,
    total: a.total + b.total
  };
}

/** Sum a list of usages, skipping undefined entries. Returns ZERO_USAGE when empty. */
export function sumTokenUsage(usages: (TokenUsage | undefined)[]): TokenUsage {
  return usages.reduce<TokenUsage>(
    (acc, u) => (u ? addTokenUsage(acc, u) : acc),
    { ...ZERO_USAGE }
  );
}

/** Compact token count, e.g. 945 -> "945", 1200 -> "1.2k", 23456 -> "23.5k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  // One decimal, but drop a trailing ".0" (e.g. 1000 -> "1k", not "1.0k").
  return `${k.toFixed(1).replace(/\.0$/, '')}k`;
}

/** Compact token count with the "tk" unit, e.g. "~1.2k tk". */
function tk(n: number): string {
  return `~${formatTokens(n)} tk`;
}

/**
 * A concise token-usage description, used for both asset/group rows and the
 * Global / Working Directory section banners (aggregate), e.g.
 *   "~80 tk (a) · ~1.2k tk (d)"  (skill/agent/command, or a section aggregate)
 *   "~1.5k tk (a)"               (always-loaded CLAUDE.md / memory)
 *   "~3.4k tk (d)"               (workflow)
 * (a) = always loaded into context; (d) = loaded on demand when used. No percentage
 * is shown: the extension does not know the active model's context window.
 * Returns undefined when there is nothing meaningful to show.
 */
export function describeTokenUsage(usage: TokenUsage | undefined): string | undefined {
  if (!usage || usage.total === 0) return undefined;
  const always = usage.upfront > 0 ? `${tk(usage.upfront)} (a)` : undefined;
  const onDemand = usage.rest > 0 ? `${tk(usage.rest)} (d)` : undefined;
  return [always, onDemand].filter(Boolean).join(' · ') || undefined;
}

/**
 * General legend for the "(a)" / "(d)" abbreviations, independent of any specific
 * usage. Shared by the section summary row's hover tooltip and the Token Legend
 * dialog so both stay in sync.
 */
export function tokenLegendLines(): string[] {
  return [
    "(a) always loaded: counted into Claude's context every turn (e.g. CLAUDE.md, a skill's name + description).",
    "(d) on demand: loaded only when that asset is actually used (e.g. a skill's body, a command, a workflow)."
  ];
}

/**
 * Multi-line legend for the "(a)" / "(d)" labels, used as a hover tooltip so the
 * abbreviations are explained without cluttering the inline row text. One line per
 * non-zero part. Returns undefined when there is nothing to show.
 */
export function tokenUsageTooltip(usage: TokenUsage | undefined): string | undefined {
  if (!usage || usage.total === 0) return undefined;
  const lines: string[] = [];
  if (usage.upfront > 0) {
    lines.push(`${tk(usage.upfront)} (a): always loaded into Claude's context every turn`);
  }
  if (usage.rest > 0) {
    lines.push(`${tk(usage.rest)} (d): loaded on demand, only when this is used`);
  }
  return lines.length ? lines.join('\n') : undefined;
}
