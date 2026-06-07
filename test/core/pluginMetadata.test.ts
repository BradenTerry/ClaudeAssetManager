import * as assert from 'assert';
import * as path from 'path';
import { makeTempDir, writeFile } from './fixtures';
import {
  readInstalledPlugins,
  readCatalogVersions,
  readCatalogPlugins,
  isOutdated,
  readEnabledPlugins,
  readKnownMarketplaces,
  InstalledPluginInfo
} from '../../src/core/pluginMetadata';

// ---------------------------------------------------------------------------
// readInstalledPlugins
// ---------------------------------------------------------------------------

describe('readInstalledPlugins', () => {
  it('AC-PM1: parses a valid installed_plugins.json and returns correct map', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'installed_plugins.json');
      const content = JSON.stringify({
        version: 2,
        plugins: {
          'skill-creator@mk': [
            {
              scope: 'user',
              installPath: '/abs/cache/mk/skill-creator/unknown',
              version: 'unknown',
              installedAt: '2025-01-01T00:00:00Z',
              lastUpdated: '2025-06-01T00:00:00Z'
            }
          ]
        }
      });
      writeFile(filePath, content);

      const result = readInstalledPlugins(filePath);

      assert.ok(result instanceof Map, 'should return a Map');
      assert.strictEqual(result.size, 1, 'should have one entry');
      assert.ok(result.has('skill-creator'), 'should have skill-creator key');

      const info = result.get('skill-creator')!;
      assert.strictEqual(info.name, 'skill-creator');
      assert.strictEqual(info.version, null, 'literal "unknown" normalizes to null');
      assert.strictEqual(info.installPath, '/abs/cache/mk/skill-creator/unknown');
      assert.strictEqual(info.lastUpdated, '2025-06-01T00:00:00Z');
    } finally {
      cleanup();
    }
  });

  it('AC-PM2: extracts name as substring before @ in key', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'installed_plugins.json');
      const content = JSON.stringify({
        version: 2,
        plugins: {
          'claude-code-setup@claude-plugins-official': [
            {
              scope: 'user',
              installPath: '/abs/cache/claude-plugins-official/claude-code-setup/1.0.0',
              version: '1.0.0',
              installedAt: '2025-01-01T00:00:00Z',
              lastUpdated: '2025-05-01T00:00:00Z'
            }
          ]
        }
      });
      writeFile(filePath, content);

      const result = readInstalledPlugins(filePath);

      assert.ok(result.has('claude-code-setup'), 'should extract name before @');
      const info = result.get('claude-code-setup')!;
      assert.strictEqual(info.name, 'claude-code-setup');
    } finally {
      cleanup();
    }
  });

  it('AC-PM2b: multiple plugins all have names extracted correctly', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'installed_plugins.json');
      const content = JSON.stringify({
        version: 2,
        plugins: {
          'frontend-design@claude-plugins-official': [
            {
              scope: 'user',
              installPath: '/abs/cache/claude-plugins-official/frontend-design/unknown',
              version: 'unknown',
              installedAt: '2025-01-01T00:00:00Z',
              lastUpdated: '2025-04-01T00:00:00Z'
            }
          ],
          'swift-lsp@claude-plugins-official': [
            {
              scope: 'user',
              installPath: '/abs/cache/claude-plugins-official/swift-lsp/1.0.0',
              version: '1.0.0',
              installedAt: '2025-02-01T00:00:00Z',
              lastUpdated: '2025-03-01T00:00:00Z'
            }
          ]
        }
      });
      writeFile(filePath, content);

      const result = readInstalledPlugins(filePath);

      assert.strictEqual(result.size, 2);
      assert.ok(result.has('frontend-design'));
      assert.ok(result.has('swift-lsp'));
      assert.strictEqual(result.get('swift-lsp')!.version, '1.0.0');
    } finally {
      cleanup();
    }
  });

  it('AC-PM3: returns empty Map when file does not exist', () => {
    const result = readInstalledPlugins('/nonexistent/path/installed_plugins.json');
    assert.ok(result instanceof Map);
    assert.strictEqual(result.size, 0, 'should return empty map for missing file');
  });

  it('AC-PM4: returns empty Map when file contains invalid JSON', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'installed_plugins.json');
      writeFile(filePath, 'not valid json {{{');

      const result = readInstalledPlugins(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-PM4b: returns empty Map when plugins field is missing', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'installed_plugins.json');
      writeFile(filePath, JSON.stringify({ version: 2 }));

      const result = readInstalledPlugins(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-PM4c: returns empty Map when plugins field is not an object', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'installed_plugins.json');
      writeFile(filePath, JSON.stringify({ version: 2, plugins: 'bad' }));

      const result = readInstalledPlugins(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// readCatalogVersions
// ---------------------------------------------------------------------------

describe('readCatalogVersions', () => {
  it('AC-PM5: parses a valid catalog cache and returns version by plugin name', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      const content = JSON.stringify({
        version: 1,
        fetchedAt: '2025-06-30T00:00:00Z',
        catalog: {
          plugins: {
            'skill-creator@mk': {
              plugin: 'skill-creator',
              version: '2.1.0',
              last_updated: '2025-07-01T00:00:00Z'
            }
          }
        }
      });
      writeFile(filePath, content);

      const result = readCatalogVersions(filePath);

      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 1);
      assert.ok(result.has('skill-creator'));
      assert.strictEqual(result.get('skill-creator'), '2.1.0');
    } finally {
      cleanup();
    }
  });

  it('AC-PM5b: extracts plugin name as substring before @ in key', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      const content = JSON.stringify({
        version: 1,
        fetchedAt: '2025-06-30T00:00:00Z',
        catalog: {
          plugins: {
            'claude-code-setup@claude-plugins-official': {
              plugin: 'claude-code-setup',
              version: '1.0.0'
            }
          }
        }
      });
      writeFile(filePath, content);

      const result = readCatalogVersions(filePath);
      assert.ok(result.has('claude-code-setup'));
      assert.strictEqual(result.get('claude-code-setup'), '1.0.0');
    } finally {
      cleanup();
    }
  });

  it('AC-PM5c: skips entries that have no version field', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      const content = JSON.stringify({
        version: 1,
        catalog: {
          plugins: {
            'frontend-design@mk': { plugin: 'frontend-design', source_sha: 'abc' }
          }
        }
      });
      writeFile(filePath, content);

      const result = readCatalogVersions(filePath);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-PM6: returns empty Map when file does not exist', () => {
    const result = readCatalogVersions('/nonexistent/path/plugin-catalog-cache.json');
    assert.ok(result instanceof Map);
    assert.strictEqual(result.size, 0);
  });

  it('AC-PM6b: returns empty Map when file contains invalid JSON', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, 'not json');

      const result = readCatalogVersions(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-PM6c: returns empty Map when catalog or catalog.plugins is missing', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, JSON.stringify({ version: 1, fetchedAt: '2025-01-01T00:00:00Z' }));

      const result = readCatalogVersions(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// isOutdated (version comparison)
// ---------------------------------------------------------------------------

describe('isOutdated', () => {
  function makeInfo(version: string | null): InstalledPluginInfo {
    return {
      name: 'test-plugin',
      id: 'test-plugin@mk',
      marketplace: 'mk',
      version,
      installPath: '/abs/cache/test-plugin/1.0.0',
      lastUpdated: '2025-06-01T00:00:00Z'
    };
  }

  it('AC-PM7: returns true when catalog version is newer than installed version', () => {
    assert.strictEqual(isOutdated(makeInfo('1.0.0'), '1.1.0'), true);
    assert.strictEqual(isOutdated(makeInfo('1.0.0'), '2.0.0'), true);
    assert.strictEqual(isOutdated(makeInfo('1.0.9'), '1.0.10'), true);
  });

  it('AC-PM8: returns false when catalog version equals installed version', () => {
    assert.strictEqual(isOutdated(makeInfo('1.0.0'), '1.0.0'), false);
  });

  it('AC-PM8b: returns false when catalog version is older than installed version', () => {
    assert.strictEqual(isOutdated(makeInfo('2.0.0'), '1.5.0'), false);
  });

  it('AC-PM9: returns false when installed version is null (unknown)', () => {
    assert.strictEqual(isOutdated(makeInfo(null), '1.0.0'), false);
  });

  it('AC-PM9b: returns false when catalog version is undefined', () => {
    assert.strictEqual(isOutdated(makeInfo('1.0.0'), undefined), false);
  });

  it('AC-PM9c: returns false when catalog version is an empty string', () => {
    assert.strictEqual(isOutdated(makeInfo('1.0.0'), ''), false);
  });

  it('AC-PM9d: returns false when catalog version is "unknown"', () => {
    assert.strictEqual(isOutdated(makeInfo('1.0.0'), 'unknown'), false);
  });
});

// ---------------------------------------------------------------------------
// readEnabledPlugins
// ---------------------------------------------------------------------------

describe('readEnabledPlugins', () => {
  it('AC-EN-1: parses enabledPlugins map from settings.json returning id->boolean', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'settings.json');
      writeFile(filePath, JSON.stringify({
        enabledPlugins: {
          'a@mk': true,
          'b@mk': false
        }
      }));

      const result = readEnabledPlugins(filePath);

      assert.ok(result instanceof Map, 'should return a Map');
      assert.strictEqual(result.size, 2, 'should have two entries');
      assert.strictEqual(result.get('a@mk'), true, 'a@mk should be true');
      assert.strictEqual(result.get('b@mk'), false, 'b@mk should be false');
    } finally {
      cleanup();
    }
  });

  it('AC-EN-1b: skips non-boolean values in enabledPlugins', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'settings.json');
      writeFile(filePath, JSON.stringify({
        enabledPlugins: {
          'a@mk': true,
          'b@mk': 'yes',
          'c@mk': 1,
          'd@mk': null
        }
      }));

      const result = readEnabledPlugins(filePath);
      assert.strictEqual(result.size, 1, 'only boolean values kept');
      assert.strictEqual(result.get('a@mk'), true);
      assert.strictEqual(result.has('b@mk'), false);
    } finally {
      cleanup();
    }
  });

  it('AC-EN-2a: returns empty Map when file does not exist', () => {
    const result = readEnabledPlugins('/nonexistent/path/settings.json');
    assert.ok(result instanceof Map);
    assert.strictEqual(result.size, 0);
  });

  it('AC-EN-2b: returns empty Map when file is malformed JSON', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'settings.json');
      writeFile(filePath, 'not valid json {{{');

      const result = readEnabledPlugins(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-EN-2c: returns empty Map when enabledPlugins key is missing', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'settings.json');
      writeFile(filePath, JSON.stringify({ someOtherKey: {} }));

      const result = readEnabledPlugins(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-EN-2d: returns empty Map when enabledPlugins is an array (not an object)', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'settings.json');
      writeFile(filePath, JSON.stringify({ enabledPlugins: ['a@mk'] }));

      const result = readEnabledPlugins(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// readKnownMarketplaces
// ---------------------------------------------------------------------------

describe('readKnownMarketplaces', () => {
  it('AC-MK-1a: parses top-level object and returns name->MarketplaceInfo with correct fields', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'known_marketplaces.json');
      writeFile(filePath, JSON.stringify({
        'mk-a': { installLocation: '/p/mk-a', lastUpdated: '2026-01-01T00:00:00Z' },
        'mk-b': {}
      }));

      const result = readKnownMarketplaces(filePath);

      assert.ok(result instanceof Map, 'should return a Map');
      assert.strictEqual(result.size, 2, 'should have two entries');

      assert.ok(result.has('mk-a'), 'should have mk-a');
      const mkA = result.get('mk-a')!;
      assert.strictEqual(mkA.name, 'mk-a');
      assert.strictEqual(mkA.installLocation, '/p/mk-a');
      assert.strictEqual(mkA.lastUpdated, '2026-01-01T00:00:00Z');

      assert.ok(result.has('mk-b'), 'should have mk-b (empty value object)');
      const mkB = result.get('mk-b')!;
      assert.strictEqual(mkB.name, 'mk-b');
      assert.strictEqual(mkB.installLocation, '', 'missing installLocation defaults to empty string');
      assert.strictEqual(mkB.lastUpdated, '', 'missing lastUpdated defaults to empty string');
    } finally {
      cleanup();
    }
  });

  it('AC-MK-1b: returns empty Map when file does not exist', () => {
    const result = readKnownMarketplaces('/nonexistent/path/known_marketplaces.json');
    assert.ok(result instanceof Map);
    assert.strictEqual(result.size, 0);
  });

  it('AC-MK-1c: returns empty Map when file contains malformed JSON', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'known_marketplaces.json');
      writeFile(filePath, 'not valid json {{{');

      const result = readKnownMarketplaces(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-MK-1d: returns empty Map when top-level value is a JSON array (not an object)', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'known_marketplaces.json');
      writeFile(filePath, JSON.stringify(['mk-a', 'mk-b']));

      const result = readKnownMarketplaces(filePath);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-MK-1e: skips entries whose value is not an object (e.g. string or null)', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'known_marketplaces.json');
      writeFile(filePath, JSON.stringify({
        'mk-a': { installLocation: '/p/mk-a', lastUpdated: '2026-01-01T00:00:00Z' },
        'bad-entry': 'a string value',
        'null-entry': null
      }));

      const result = readKnownMarketplaces(filePath);
      assert.strictEqual(result.size, 1, 'should only include the valid entry');
      assert.ok(result.has('mk-a'));
      assert.ok(!result.has('bad-entry'));
      assert.ok(!result.has('null-entry'));
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// readCatalogPlugins
// ---------------------------------------------------------------------------

describe('readCatalogPlugins', () => {
  it('AC-CAT-1: parses catalog.plugins object and returns entries with correct fields', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, JSON.stringify({
        catalog: {
          plugins: {
            'foo@mk': { plugin: 'foo', version: '1.2.0', marketplace_entry: { description: 'Foo desc' } },
            'bar@mk': { plugin: 'bar', version: '2.0.0' },
            'noatkey': { plugin: 'noatkey', version: '0.1.0' }
          }
        }
      }));

      const result = readCatalogPlugins(filePath);

      assert.strictEqual(result.length, 3, 'should return 3 entries');

      const foo = result.find(p => p.id === 'foo@mk');
      assert.ok(foo, 'should have foo@mk entry');
      assert.strictEqual(foo!.name, 'foo');
      assert.strictEqual(foo!.marketplace, 'mk');
      assert.strictEqual(foo!.version, '1.2.0');
      assert.strictEqual(foo!.description, 'Foo desc');

      const bar = result.find(p => p.id === 'bar@mk');
      assert.ok(bar, 'should have bar@mk entry');
      assert.strictEqual(bar!.name, 'bar');
      assert.strictEqual(bar!.marketplace, 'mk');
      assert.strictEqual(bar!.version, '2.0.0');
      assert.strictEqual(bar!.description, undefined, 'bar has no marketplace_entry so description should be undefined');

      const noat = result.find(p => p.id === 'noatkey');
      assert.ok(noat, 'should have noatkey entry');
      assert.strictEqual(noat!.marketplace, '', 'key with no @ should have empty marketplace');
    } finally {
      cleanup();
    }
  });

  it('AC-CAT-3: entry whose key has no @ still parses with marketplace=""', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, JSON.stringify({
        catalog: {
          plugins: {
            'standalone': { plugin: 'standalone', version: '1.0.0' }
          }
        }
      }));

      const result = readCatalogPlugins(filePath);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'standalone');
      assert.strictEqual(result[0].name, 'standalone');
      assert.strictEqual(result[0].marketplace, '');
      assert.strictEqual(result[0].version, '1.0.0');
      assert.strictEqual(result[0].description, undefined);
    } finally {
      cleanup();
    }
  });

  it('AC-CAT-2a: returns [] when file does not exist', () => {
    const result = readCatalogPlugins('/nonexistent/path/plugin-catalog-cache.json');
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });

  it('AC-CAT-2b: returns [] when file contains malformed JSON', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, 'not valid json {{{');

      const result = readCatalogPlugins(filePath);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-CAT-2c: returns [] when file is empty object {}', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, JSON.stringify({}));

      const result = readCatalogPlugins(filePath);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-CAT-2d: returns [] when catalog exists but has no plugins key', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, JSON.stringify({ catalog: {} }));

      const result = readCatalogPlugins(filePath);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 0);
    } finally {
      cleanup();
    }
  });

  it('AC-CAT-2e: returns [] when catalog.plugins is an array (not an object)', () => {
    const { root, cleanup } = makeTempDir();
    try {
      const filePath = path.join(root, 'plugin-catalog-cache.json');
      writeFile(filePath, JSON.stringify({ catalog: { plugins: ['foo@mk', 'bar@mk'] } }));

      const result = readCatalogPlugins(filePath);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 0);
    } finally {
      cleanup();
    }
  });
});
