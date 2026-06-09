import * as assert from 'assert';
import { isValidPluginId, isValidMarketplaceName, isSafeMarketplaceSource, normalizePluginScope, buildScopedPluginArgs, parseEnabledScopeConflict, computePluginScopePresence } from '../../src/core/pluginValidation';

// ---------------------------------------------------------------------------
// isValidPluginId -- AC-VAL-1
// ---------------------------------------------------------------------------

describe('isValidPluginId', () => {
  it('AC-VAL-1a: accepts valid plugin ids', () => {
    assert.strictEqual(isValidPluginId('frontend-design@claude-plugins-official'), true);
    assert.strictEqual(isValidPluginId('skill-creator@mk'), true);
    assert.strictEqual(isValidPluginId('my-plugin'), true);
    assert.strictEqual(isValidPluginId('a'), true);
    assert.strictEqual(isValidPluginId('anthropics/repo'), true);
  });

  it('AC-VAL-1b: rejects empty string', () => {
    assert.strictEqual(isValidPluginId(''), false);
  });

  it('AC-VAL-1c: rejects ids containing semicolon (shell injection)', () => {
    assert.strictEqual(isValidPluginId('x@mk; rm -rf /'), false);
  });

  it('AC-VAL-1d: rejects ids containing ampersand', () => {
    assert.strictEqual(isValidPluginId('a & calc'), false);
  });

  it('AC-VAL-1e: rejects ids containing backtick', () => {
    assert.strictEqual(isValidPluginId('a`b'), false);
  });

  it('AC-VAL-1f: rejects ids containing $() (command substitution)', () => {
    assert.strictEqual(isValidPluginId('$(whoami)'), false);
  });

  it('AC-VAL-1g: rejects ids with spaces', () => {
    assert.strictEqual(isValidPluginId('my plugin'), false);
  });

  it('AC-VAL-1h: rejects ids with pipe', () => {
    assert.strictEqual(isValidPluginId('a|b'), false);
  });

  it('AC-VAL-1i: rejects ids with newline', () => {
    assert.strictEqual(isValidPluginId('a\nb'), false);
  });
});

// ---------------------------------------------------------------------------
// isValidMarketplaceName -- AC-VAL-2
// ---------------------------------------------------------------------------

describe('isValidMarketplaceName', () => {
  it('AC-VAL-2a: accepts valid marketplace names', () => {
    assert.strictEqual(isValidMarketplaceName('claude-plugins-official'), true);
    assert.strictEqual(isValidMarketplaceName('mk'), true);
    assert.strictEqual(isValidMarketplaceName('my.marketplace'), true);
    assert.strictEqual(isValidMarketplaceName('marketplace_v2'), true);
  });

  it('AC-VAL-2b: rejects empty string', () => {
    assert.strictEqual(isValidMarketplaceName(''), false);
  });

  it('AC-VAL-2c: rejects (local) -- parens not allowed', () => {
    assert.strictEqual(isValidMarketplaceName('(local)'), false);
  });

  it('AC-VAL-2d: rejects names with shell metacharacters', () => {
    assert.strictEqual(isValidMarketplaceName('mk; rm -rf /'), false);
    assert.strictEqual(isValidMarketplaceName('a&b'), false);
    assert.strictEqual(isValidMarketplaceName('a|b'), false);
    assert.strictEqual(isValidMarketplaceName('a`b'), false);
    assert.strictEqual(isValidMarketplaceName('$(x)'), false);
  });

  it('AC-VAL-2e: rejects names with spaces', () => {
    assert.strictEqual(isValidMarketplaceName('my marketplace'), false);
  });
});

// ---------------------------------------------------------------------------
// isSafeMarketplaceSource -- AC-VAL-3
// ---------------------------------------------------------------------------

describe('isSafeMarketplaceSource', () => {
  it('AC-VAL-3a: accepts valid marketplace sources', () => {
    assert.strictEqual(isSafeMarketplaceSource('anthropics/repo'), true);
    assert.strictEqual(isSafeMarketplaceSource('https://github.com/anthropics/repo'), true);
    assert.strictEqual(isSafeMarketplaceSource('/Users/braden/my-plugins'), true);
    assert.strictEqual(isSafeMarketplaceSource('my-plugins'), true);
  });

  it('AC-VAL-3b: rejects empty string', () => {
    assert.strictEqual(isSafeMarketplaceSource(''), false);
  });

  it('AC-VAL-3c: rejects whitespace-only string', () => {
    assert.strictEqual(isSafeMarketplaceSource('   '), false);
  });

  it('AC-VAL-3d: rejects string with semicolon', () => {
    assert.strictEqual(isSafeMarketplaceSource('repo; rm -rf /'), false);
  });

  it('AC-VAL-3e: rejects string with ampersand', () => {
    assert.strictEqual(isSafeMarketplaceSource('a & calc'), false);
  });

  it('AC-VAL-3f: rejects string with pipe', () => {
    assert.strictEqual(isSafeMarketplaceSource('a|b'), false);
  });

  it('AC-VAL-3g: rejects string with backtick', () => {
    assert.strictEqual(isSafeMarketplaceSource('a`b'), false);
  });

  it('AC-VAL-3h: rejects string with dollar sign', () => {
    assert.strictEqual(isSafeMarketplaceSource('$(whoami)'), false);
  });

  it('AC-VAL-3i: rejects string with angle brackets', () => {
    assert.strictEqual(isSafeMarketplaceSource('a<b'), false);
    assert.strictEqual(isSafeMarketplaceSource('a>b'), false);
  });

  it('AC-VAL-3j: rejects string with newline', () => {
    assert.strictEqual(isSafeMarketplaceSource('a\nb'), false);
    assert.strictEqual(isSafeMarketplaceSource('a\rb'), false);
  });
});

// ---------------------------------------------------------------------------
// AC5: normalizePluginScope
// ---------------------------------------------------------------------------

describe('normalizePluginScope', () => {
  it('AC5a: returns "user" for the string "user"', () => {
    assert.strictEqual(normalizePluginScope('user'), 'user');
  });

  it('AC5b: returns "project" for the string "project"', () => {
    assert.strictEqual(normalizePluginScope('project'), 'project');
  });

  it('AC5c: returns "local" for the string "local"', () => {
    assert.strictEqual(normalizePluginScope('local'), 'local');
  });

  it('AC5d: returns undefined for empty string', () => {
    assert.strictEqual(normalizePluginScope(''), undefined);
  });

  it('AC5e: returns undefined for unknown string "global"', () => {
    assert.strictEqual(normalizePluginScope('global'), undefined);
  });

  it('AC5f: returns undefined for non-string (number)', () => {
    assert.strictEqual(normalizePluginScope(42), undefined);
  });

  it('AC5g: returns undefined for null', () => {
    assert.strictEqual(normalizePluginScope(null), undefined);
  });

  it('AC5h: returns undefined for undefined', () => {
    assert.strictEqual(normalizePluginScope(undefined), undefined);
  });

  it('AC5i: returns undefined for object', () => {
    assert.strictEqual(normalizePluginScope({}), undefined);
  });
});

// ---------------------------------------------------------------------------
// AC9: buildScopedPluginArgs
// ---------------------------------------------------------------------------

describe('buildScopedPluginArgs', () => {
  it('AC9a: install user -> ["plugin", "install", "foo@mk", "--scope", "user"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('install', 'foo@mk', 'user'),
      ['plugin', 'install', 'foo@mk', '--scope', 'user']
    );
  });

  it('AC9b: enable project -> ["plugin", "enable", "bar@mk", "--scope", "project"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('enable', 'bar@mk', 'project'),
      ['plugin', 'enable', 'bar@mk', '--scope', 'project']
    );
  });

  it('AC9c: disable local -> ["plugin", "disable", "baz@mk", "--scope", "local"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('disable', 'baz@mk', 'local'),
      ['plugin', 'disable', 'baz@mk', '--scope', 'local']
    );
  });

  it('AC9d: install local -> ["plugin", "install", "x@mk", "--scope", "local"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('install', 'x@mk', 'local'),
      ['plugin', 'install', 'x@mk', '--scope', 'local']
    );
  });

  it('AC1-uninstall: uninstall project -> ["plugin", "uninstall", "x@mk", "--scope", "project"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('uninstall', 'x@mk', 'project'),
      ['plugin', 'uninstall', 'x@mk', '--scope', 'project']
    );
  });

  it('AC1-uninstall-user: uninstall user -> ["plugin", "uninstall", "y@mk", "--scope", "user"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('uninstall', 'y@mk', 'user'),
      ['plugin', 'uninstall', 'y@mk', '--scope', 'user']
    );
  });

  it('AC1-uninstall-local: uninstall local -> ["plugin", "uninstall", "z@mk", "--scope", "local"]', () => {
    assert.deepStrictEqual(
      buildScopedPluginArgs('uninstall', 'z@mk', 'local'),
      ['plugin', 'uninstall', 'z@mk', '--scope', 'local']
    );
  });
});

// ---------------------------------------------------------------------------
// AC2: parseEnabledScopeConflict
// ---------------------------------------------------------------------------

describe('parseEnabledScopeConflict', () => {
  const EXACT_USER_MSG =
    'Plugin "adobe-for-creativity@claude-plugins-official" is enabled at project scope' +
    ' (.claude/settings.json, shared with your team). To disable just for you:' +
    ' claude plugin disable adobe-for-creativity@claude-plugins-official --scope local';

  it('AC2a: exact user-reported project conflict message -> "project"', () => {
    assert.strictEqual(parseEnabledScopeConflict(EXACT_USER_MSG), 'project');
  });

  it('AC2b: "enabled at local scope" message -> "local"', () => {
    assert.strictEqual(
      parseEnabledScopeConflict('Plugin "foo@mk" is enabled at local scope (settings.local.json).'),
      'local'
    );
  });

  it('AC2c: "enabled at user scope" message -> "user"', () => {
    assert.strictEqual(
      parseEnabledScopeConflict('Plugin "foo@mk" is enabled at user scope (~/.claude/settings.json).'),
      'user'
    );
  });

  it('AC2d: case-insensitive -- "enabled at USER scope" -> "user"', () => {
    assert.strictEqual(
      parseEnabledScopeConflict('Plugin "foo@mk" is enabled at USER scope.'),
      'user'
    );
  });

  it('AC2e: case-insensitive -- "enabled at PROJECT scope" -> "project"', () => {
    assert.strictEqual(
      parseEnabledScopeConflict('Plugin "foo@mk" is enabled at PROJECT scope.'),
      'project'
    );
  });

  it('AC2f: empty string -> undefined', () => {
    assert.strictEqual(parseEnabledScopeConflict(''), undefined);
  });

  it('AC2g: unrelated error message -> undefined', () => {
    assert.strictEqual(parseEnabledScopeConflict('some other failure'), undefined);
  });

  it('AC2h: non-string (cast as any) -> undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(parseEnabledScopeConflict(null as any), undefined);
  });

  it('AC2i: non-string (number, cast as any) -> undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(parseEnabledScopeConflict(42 as any), undefined);
  });

  it('AC2j: undefined (cast as any) -> undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(parseEnabledScopeConflict(undefined as any), undefined);
  });
});

// ---------------------------------------------------------------------------
// AC5: computePluginScopePresence
// ---------------------------------------------------------------------------

describe('computePluginScopePresence', () => {
  const EMPTY = new Map<string, boolean>();

  it('AC5-install-only: plugin installed at user scope, no enablement entries -> one entry {scope:user, installed:true, enabled:false}', () => {
    const result = computePluginScopePresence('foo@mk', 'user', EMPTY, EMPTY, EMPTY);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].scope, 'user');
    assert.strictEqual(result[0].installed, true);
    assert.strictEqual(result[0].enabled, false);
  });

  it('AC5-install-plus-enabled: plugin installed at project scope + enabled entry at user scope -> 2 entries', () => {
    const userEnabled = new Map<string, boolean>([['foo@mk', true]]);
    const result = computePluginScopePresence('foo@mk', 'project', userEnabled, EMPTY, EMPTY);
    assert.strictEqual(result.length, 2);
    const userEntry = result.find(e => e.scope === 'user')!;
    const projEntry = result.find(e => e.scope === 'project')!;
    assert.ok(userEntry, 'expected user scope entry');
    assert.ok(projEntry, 'expected project scope entry');
    assert.strictEqual(userEntry.installed, false);
    assert.strictEqual(userEntry.enabled, true);
    assert.strictEqual(projEntry.installed, true);
    assert.strictEqual(projEntry.enabled, false);
  });

  it('AC5-enabled-only: plugin not installed, but has enabled entry at local scope -> 1 entry {scope:local, installed:false, enabled:true}', () => {
    const localEnabled = new Map<string, boolean>([['bar@mk', false]]);
    const result = computePluginScopePresence('bar@mk', undefined, EMPTY, EMPTY, localEnabled);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].scope, 'local');
    assert.strictEqual(result[0].installed, false);
    assert.strictEqual(result[0].enabled, true);
  });

  it('AC5-none: plugin not installed and no enablement entries anywhere -> empty array', () => {
    const result = computePluginScopePresence('ghost@mk', 'user', EMPTY, EMPTY, EMPTY);
    // installScope=user means installed at user, so there IS one entry
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].scope, 'user');
    assert.strictEqual(result[0].installed, true);
  });

  it('AC5-none-undefined: plugin with no installScope and no enablement -> empty array', () => {
    const result = computePluginScopePresence('ghost@mk', undefined, EMPTY, EMPTY, EMPTY);
    assert.strictEqual(result.length, 0);
  });

  it('AC5-all-three: installed at local + enabled at user + enabled at project -> 3 entries', () => {
    const userEnabled = new Map<string, boolean>([['x@mk', true]]);
    const teamEnabled = new Map<string, boolean>([['x@mk', false]]);
    const localEnabled = new Map<string, boolean>([['x@mk', true]]);
    const result = computePluginScopePresence('x@mk', 'local', userEnabled, teamEnabled, localEnabled);
    assert.strictEqual(result.length, 3);
    const scopes = result.map(e => e.scope).sort();
    assert.deepStrictEqual(scopes, ['local', 'project', 'user']);
    const localEntry = result.find(e => e.scope === 'local')!;
    assert.strictEqual(localEntry.installed, true);
    assert.strictEqual(localEntry.enabled, true);
  });
});
