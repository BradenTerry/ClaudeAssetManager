import * as assert from 'assert';
import * as path from 'path';
import { makeTempDir, writeFile } from './fixtures';
import {
  readInstalledPlugins,
  readCatalogVersions,
  isOutdated,
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
      assert.strictEqual(info.version, 'unknown');
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
  function makeInfo(version: string): InstalledPluginInfo {
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

  it('AC-PM9: returns false when installed version is "unknown"', () => {
    assert.strictEqual(isOutdated(makeInfo('unknown'), '1.0.0'), false);
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
