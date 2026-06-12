import * as assert from 'assert';
import { AssetType } from '../../src/core/types';
import {
  estimateTokens,
  computeTokenUsage,
  addTokenUsage,
  sumTokenUsage,
  formatTokens,
  describeTokenUsage,
  tokenUsageTooltip,
  ZERO_USAGE
} from '../../src/core/tokenCount';

// ---------------------------------------------------------------------------
// AC1: estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens -- AC1', () => {
  it('returns 0 for empty and whitespace-only input', () => {
    assert.strictEqual(estimateTokens(''), 0);
    assert.strictEqual(estimateTokens('   \n\t'), 0);
    assert.strictEqual(estimateTokens(undefined), 0);
  });

  it('approximates ~4 chars per token (ceil)', () => {
    assert.strictEqual(estimateTokens('abcd'), 1); // 4/4
    assert.strictEqual(estimateTokens('abcde'), 2); // 5/4 -> ceil 2
    assert.strictEqual(estimateTokens('a'.repeat(40)), 10);
  });

  it('is monotonic in length', () => {
    assert.ok(estimateTokens('a'.repeat(100)) > estimateTokens('a'.repeat(50)));
  });
});

// ---------------------------------------------------------------------------
// AC2: computeTokenUsage -- skills/agents split name+description vs body
// ---------------------------------------------------------------------------

describe('computeTokenUsage -- AC2 (Skill/Subagent)', () => {
  const body = 'This is the long body of the skill. '.repeat(20);
  const content = `---\nname: my-skill\ndescription: A short summary of what it does.\n---\n${body}`;

  it('Skill: upfront = name+description tokens, rest = body tokens', () => {
    const u = computeTokenUsage(AssetType.Skill, content);
    const expectedUpfront = estimateTokens('my-skill\nA short summary of what it does.');
    assert.strictEqual(u.upfront, expectedUpfront);
    assert.strictEqual(u.rest, estimateTokens(body));
    assert.strictEqual(u.total, u.upfront + u.rest);
    assert.ok(u.rest > u.upfront, 'body should dominate the total here');
  });

  it('Subagent: same split as Skill', () => {
    const u = computeTokenUsage(AssetType.Subagent, content);
    assert.strictEqual(u.upfront, estimateTokens('my-skill\nA short summary of what it does.'));
    assert.strictEqual(u.rest, estimateTokens(body));
  });

  it('no frontmatter -> upfront 0, rest = whole content', () => {
    const plain = 'just a body, no frontmatter at all';
    const u = computeTokenUsage(AssetType.Skill, plain);
    assert.strictEqual(u.upfront, 0);
    assert.strictEqual(u.rest, estimateTokens(plain));
  });
});

// ---------------------------------------------------------------------------
// AC3: computeTokenUsage -- other types
// ---------------------------------------------------------------------------

describe('computeTokenUsage -- AC3 (other types)', () => {
  it('Command: upfront = description only (no name field), rest = body', () => {
    const body = 'Run the thing with $ARGUMENTS and report.';
    const content = `---\ndescription: Does a thing.\nargument-hint: <x>\n---\n${body}`;
    const u = computeTokenUsage(AssetType.Command, content);
    assert.strictEqual(u.upfront, estimateTokens('Does a thing.'));
    assert.strictEqual(u.rest, estimateTokens(body));
  });

  it('ClaudeMd: upfront = whole file, rest = 0 (always loaded)', () => {
    const content = '# Project rules\nAlways do X. Never do Y.';
    const u = computeTokenUsage(AssetType.ClaudeMd, content);
    assert.strictEqual(u.upfront, estimateTokens(content));
    assert.strictEqual(u.rest, 0);
    assert.strictEqual(u.total, u.upfront);
  });

  it('Memory: upfront = whole file, rest = 0', () => {
    const content = 'remembered fact one. remembered fact two.';
    const u = computeTokenUsage(AssetType.Memory, content);
    assert.strictEqual(u.upfront, estimateTokens(content));
    assert.strictEqual(u.rest, 0);
  });

  it('Workflow: upfront = 0, rest = whole file (on-demand)', () => {
    const content = 'export const meta = {}; // a workflow script';
    const u = computeTokenUsage(AssetType.Workflow, content);
    assert.strictEqual(u.upfront, 0);
    assert.strictEqual(u.rest, estimateTokens(content));
  });

  it('Config: contributes no tokens (never injected as context)', () => {
    const u = computeTokenUsage(AssetType.Config, '{"a":1}');
    assert.deepStrictEqual(u, ZERO_USAGE);
  });
});

// ---------------------------------------------------------------------------
// AC4: summing
// ---------------------------------------------------------------------------

describe('token summing -- AC4', () => {
  it('addTokenUsage adds field-wise', () => {
    const r = addTokenUsage({ upfront: 1, rest: 2, total: 3 }, { upfront: 10, rest: 20, total: 30 });
    assert.deepStrictEqual(r, { upfront: 11, rest: 22, total: 33 });
  });

  it('sumTokenUsage skips undefined and totals the rest', () => {
    const r = sumTokenUsage([
      { upfront: 5, rest: 0, total: 5 },
      undefined,
      { upfront: 0, rest: 7, total: 7 }
    ]);
    assert.deepStrictEqual(r, { upfront: 5, rest: 7, total: 12 });
  });

  it('sumTokenUsage of empty list is ZERO_USAGE (fresh object)', () => {
    const r = sumTokenUsage([]);
    assert.deepStrictEqual(r, ZERO_USAGE);
    assert.notStrictEqual(r, ZERO_USAGE, 'should not return the shared constant by reference');
  });
});

// ---------------------------------------------------------------------------
// AC5: formatTokens
// ---------------------------------------------------------------------------

describe('formatTokens -- AC5', () => {
  it('plain integer below 1000', () => {
    assert.strictEqual(formatTokens(0), '0');
    assert.strictEqual(formatTokens(999), '999');
  });

  it('compact k notation at/above 1000, dropping a trailing .0', () => {
    assert.strictEqual(formatTokens(1000), '1k');
    assert.strictEqual(formatTokens(1200), '1.2k');
    assert.strictEqual(formatTokens(1500), '1.5k');
    assert.strictEqual(formatTokens(23456), '23.5k');
  });
});

// ---------------------------------------------------------------------------
// AC6: describeTokenUsage
// ---------------------------------------------------------------------------

describe('describeTokenUsage -- AC6', () => {
  it('undefined / zero -> undefined (nothing to show)', () => {
    assert.strictEqual(describeTokenUsage(undefined), undefined);
    assert.strictEqual(describeTokenUsage(ZERO_USAGE), undefined);
  });

  it('both upfront and rest -> "(a) · (d)" with tk unit', () => {
    assert.strictEqual(describeTokenUsage({ upfront: 80, rest: 1200, total: 1280 }), '~80 tk (a) · ~1.2k tk (d)');
  });

  it('upfront only (always-loaded) -> "(a)"', () => {
    assert.strictEqual(describeTokenUsage({ upfront: 1500, rest: 0, total: 1500 }), '~1.5k tk (a)');
  });

  it('rest only (on-demand) -> "(d)"', () => {
    assert.strictEqual(describeTokenUsage({ upfront: 0, rest: 3400, total: 3400 }), '~3.4k tk (d)');
  });
});

// ---------------------------------------------------------------------------
// AC7: tokenUsageTooltip (hover legend explaining (a)/(d))
// ---------------------------------------------------------------------------

describe('tokenUsageTooltip -- AC7', () => {
  it('explains both (a) and (d) on separate lines', () => {
    const t = tokenUsageTooltip({ upfront: 80, rest: 1200, total: 1280 });
    const lines = t!.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(/^~80 tk \(a\): always loaded/.test(lines[0]), lines[0]);
    assert.ok(/^~1\.2k tk \(d\): loaded on demand/.test(lines[1]), lines[1]);
  });

  it('shows only the (a) line when there is no on-demand portion', () => {
    const t = tokenUsageTooltip({ upfront: 500, rest: 0, total: 500 });
    assert.strictEqual(t, "~500 tk (a): always loaded into Claude's context every turn");
  });

  it('returns undefined for empty usage', () => {
    assert.strictEqual(tokenUsageTooltip(ZERO_USAGE), undefined);
    assert.strictEqual(tokenUsageTooltip(undefined), undefined);
  });
});

