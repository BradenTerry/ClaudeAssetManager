import * as assert from 'assert';
import { isValidPluginId, isValidMarketplaceName, isSafeMarketplaceSource } from '../../src/core/pluginValidation';

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
