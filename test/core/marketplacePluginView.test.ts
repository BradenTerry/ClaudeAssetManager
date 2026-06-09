import * as assert from 'assert';
import { buildMarketplacePluginRows, pageMarketplaceRows, MarketplacePluginRow } from '../../src/core/marketplacePluginView';
import { InstalledPluginInfo, CatalogPlugin } from '../../src/core/pluginMetadata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstalled(name: string, marketplace: string, version: string | null): InstalledPluginInfo {
  const id = marketplace ? `${name}@${marketplace}` : name;
  return { name, id, marketplace, version, installPath: `/cache/${name}`, lastUpdated: '2025-01-01T00:00:00Z', scope: 'user' };
}

function makeCatalog(name: string, marketplace: string, version: string, description?: string): CatalogPlugin {
  const id = marketplace ? `${name}@${marketplace}` : name;
  return { id, name, marketplace, version, description };
}

/** Build installed Map keyed by name. */
function installedMap(...infos: InstalledPluginInfo[]): Map<string, InstalledPluginInfo> {
  const m = new Map<string, InstalledPluginInfo>();
  for (const i of infos) m.set(i.name, i);
  return m;
}

/** Build enabled Map keyed by id. */
function enabledMap(entries: Record<string, boolean>): Map<string, boolean> {
  return new Map(Object.entries(entries));
}

/** Build catalogVersions Map keyed by name. */
function versionsMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

// ---------------------------------------------------------------------------
// AC1: union by id -- no duplicates
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC1: union, no duplicates', () => {
  it('AC1: catalog-only plugin + installed-only plugin + overlap yields 3 unique rows', () => {
    // catalog-only: alpha@mk (not installed)
    // installed-only: beta@mk (not in catalog)
    // overlap: gamma@mk in both
    const catalog: CatalogPlugin[] = [
      makeCatalog('alpha', 'mk', '1.0.0'),
      makeCatalog('gamma', 'mk', '2.0.0')
    ];
    const installed = installedMap(
      makeInstalled('beta', 'mk', '0.5.0'),
      makeInstalled('gamma', 'mk', '1.9.0')
    );
    const rows = buildMarketplacePluginRows('mk', installed, catalog, new Map(), new Map());
    assert.strictEqual(rows.length, 3, 'should have exactly 3 rows (no duplicate for gamma)');
    const ids = rows.map(r => r.id);
    assert.ok(ids.includes('alpha@mk'), 'alpha@mk present');
    assert.ok(ids.includes('beta@mk'), 'beta@mk present');
    assert.ok(ids.includes('gamma@mk'), 'gamma@mk present');
    // No duplicates
    assert.strictEqual(new Set(ids).size, 3);
  });
});

// ---------------------------------------------------------------------------
// AC2: available-only plugin
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC2: available-only', () => {
  it('AC2: catalog entry not installed -> installed=false, enabled=undefined, outdated=false', () => {
    const catalog = [makeCatalog('alpha', 'mk', '1.0.0', 'A tool')];
    const rows = buildMarketplacePluginRows('mk', new Map(), catalog, new Map(), new Map());
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row.id, 'alpha@mk');
    assert.strictEqual(row.name, 'alpha');
    assert.strictEqual(row.version, '1.0.0');
    assert.strictEqual(row.description, 'A tool');
    assert.strictEqual(row.installed, false);
    assert.strictEqual(row.enabled, undefined);
    assert.strictEqual(row.outdated, false);
  });
});

// ---------------------------------------------------------------------------
// AC3: installed + enabled
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC3: installed+enabled', () => {
  it('AC3: installed plugin with enabled=true -> installed=true, enabled=true', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const enabled = enabledMap({ 'foo@mk': true });
    const rows = buildMarketplacePluginRows('mk', installed, [], enabled, new Map());
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row.installed, true);
    assert.strictEqual(row.enabled, true);
  });
});

// ---------------------------------------------------------------------------
// AC4: installed + disabled
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC4: installed+disabled', () => {
  it('AC4a: installed plugin with enabled=false -> installed=true, enabled=false', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const enabled = enabledMap({ 'foo@mk': false });
    const rows = buildMarketplacePluginRows('mk', installed, [], enabled, new Map());
    assert.strictEqual(rows[0].installed, true);
    assert.strictEqual(rows[0].enabled, false);
  });

  it('AC4b: installed plugin absent from enabled map -> installed=true, enabled=false', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), new Map());
    assert.strictEqual(rows[0].installed, true);
    assert.strictEqual(rows[0].enabled, false);
  });
});

// ---------------------------------------------------------------------------
// AC5: outdated
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC5: outdated', () => {
  it('AC5a: catalog version newer than installed -> outdated=true', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const versions = versionsMap({ foo: '2.0.0' });
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), versions);
    assert.strictEqual(rows[0].outdated, true);
  });

  it('AC5b: catalog version equal to installed -> outdated=false', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const versions = versionsMap({ foo: '1.0.0' });
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), versions);
    assert.strictEqual(rows[0].outdated, false);
  });

  it('AC5c: no catalog version -> outdated=false', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), new Map());
    assert.strictEqual(rows[0].outdated, false);
  });

  it('AC5d: installed version null -> outdated=false regardless of catalog', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', null));
    const versions = versionsMap({ foo: '2.0.0' });
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), versions);
    assert.strictEqual(rows[0].outdated, false);
  });
});

// ---------------------------------------------------------------------------
// AC6: local marketplace ("")
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC6: local marketplace', () => {
  it('AC6a: plugin from "" marketplace returned when requesting ""', () => {
    const installed = installedMap(makeInstalled('local-plug', '', '1.0.0'));
    const rows = buildMarketplacePluginRows('', installed, [], new Map(), new Map());
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'local-plug');
    assert.strictEqual(rows[0].name, 'local-plug');
  });

  it('AC6b: plugin from "" marketplace excluded when requesting another marketplace', () => {
    const installed = installedMap(makeInstalled('local-plug', '', '1.0.0'));
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), new Map());
    assert.strictEqual(rows.length, 0);
  });

  it('AC6c: "" catalog plugin returned when requesting "", excluded for other mk', () => {
    const catalog = [makeCatalog('local-cat', '', '1.0.0')];
    const rowsLocal = buildMarketplacePluginRows('', new Map(), catalog, new Map(), new Map());
    assert.strictEqual(rowsLocal.length, 1);
    const rowsMk = buildMarketplacePluginRows('mk', new Map(), catalog, new Map(), new Map());
    assert.strictEqual(rowsMk.length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC7: empty marketplace -> []
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC7: empty marketplace', () => {
  it('AC7: no catalog + no installed for marketplace -> []', () => {
    const installed = installedMap(makeInstalled('other-plugin', 'other-mk', '1.0.0'));
    const catalog = [makeCatalog('other-cat', 'other-mk', '1.0.0')];
    const rows = buildMarketplacePluginRows('mk', installed, catalog, new Map(), new Map());
    assert.strictEqual(rows.length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC8: sorted by name case-insensitive
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC8: sort by name', () => {
  it('AC8: rows sorted case-insensitively by name', () => {
    const catalog = [
      makeCatalog('Zebra', 'mk', '1.0.0'),
      makeCatalog('apple', 'mk', '1.0.0'),
      makeCatalog('Mango', 'mk', '1.0.0'),
      makeCatalog('banana', 'mk', '1.0.0')
    ];
    const rows = buildMarketplacePluginRows('mk', new Map(), catalog, new Map(), new Map());
    const names = rows.map(r => r.name.toLowerCase());
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    assert.deepStrictEqual(names, sorted);
  });
});

// ---------------------------------------------------------------------------
// AC9: version preference
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC9: version preference', () => {
  it('AC9a: catalog version present -> use catalog version', () => {
    const catalog = [makeCatalog('foo', 'mk', '2.0.0')];
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const rows = buildMarketplacePluginRows('mk', installed, catalog, new Map(), new Map());
    assert.strictEqual(rows[0].version, '2.0.0');
  });

  it('AC9b: no catalog version (empty string) -> use installed version', () => {
    const catalog = [makeCatalog('foo', 'mk', '')];
    const installed = installedMap(makeInstalled('foo', 'mk', '1.0.0'));
    const rows = buildMarketplacePluginRows('mk', installed, catalog, new Map(), new Map());
    assert.strictEqual(rows[0].version, '1.0.0');
  });

  it('AC9c: no catalog entry, installed version null -> version is ""', () => {
    const installed = installedMap(makeInstalled('foo', 'mk', null));
    const rows = buildMarketplacePluginRows('mk', installed, [], new Map(), new Map());
    assert.strictEqual(rows[0].version, '');
  });

  it('AC9d: catalog-only with no version -> version is ""', () => {
    const catalog = [makeCatalog('foo', 'mk', '')];
    const rows = buildMarketplacePluginRows('mk', new Map(), catalog, new Map(), new Map());
    assert.strictEqual(rows[0].version, '');
  });
});

// ---------------------------------------------------------------------------
// pageMarketplaceRows helpers
// ---------------------------------------------------------------------------

function makeRow(name: string, description?: string): MarketplacePluginRow {
  return {
    id: `${name}@mk`,
    name,
    version: '1.0.0',
    description,
    installed: false,
    enabled: undefined,
    outdated: false
  };
}

function manyRows(count: number): MarketplacePluginRow[] {
  return Array.from({ length: count }, (_, i) => makeRow(`plugin-${String(i + 1).padStart(3, '0')}`));
}

// ---------------------------------------------------------------------------
// AC1: empty query -> first pageSize rows, correct pageCount
// ---------------------------------------------------------------------------

describe('pageMarketplaceRows -- AC1: empty query, pagination math', () => {
  it('AC1a: 120 rows, pageSize 50, page 1 -> 50 rows, pageCount 3', () => {
    const rows = manyRows(120);
    const result = pageMarketplaceRows(rows, { page: 1, pageSize: 50, query: '' });
    assert.strictEqual(result.rows.length, 50);
    assert.strictEqual(result.pageCount, 3);
    assert.strictEqual(result.totalCount, 120);
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.rows[0].name, 'plugin-001');
    assert.strictEqual(result.rows[49].name, 'plugin-050');
  });

  it('AC1b: 50 rows, pageSize 50 -> pageCount 1', () => {
    const result = pageMarketplaceRows(manyRows(50), { page: 1, pageSize: 50, query: '' });
    assert.strictEqual(result.pageCount, 1);
    assert.strictEqual(result.rows.length, 50);
  });

  it('AC1c: 1 row, pageSize 50 -> pageCount 1', () => {
    const result = pageMarketplaceRows([makeRow('a')], { page: 1, pageSize: 50, query: '' });
    assert.strictEqual(result.pageCount, 1);
    assert.strictEqual(result.rows.length, 1);
  });
});

// ---------------------------------------------------------------------------
// AC2: filter by name and description, case-insensitive
// ---------------------------------------------------------------------------

describe('pageMarketplaceRows -- AC2: search filter', () => {
  it('AC2a: filter by name (case-insensitive)', () => {
    const rows = [makeRow('AlphaTool'), makeRow('betaTool'), makeRow('gamma')];
    const result = pageMarketplaceRows(rows, { page: 1, pageSize: 50, query: 'ALPHA' });
    assert.strictEqual(result.totalCount, 1);
    assert.strictEqual(result.rows[0].name, 'AlphaTool');
  });

  it('AC2b: filter by description (case-insensitive)', () => {
    const rows = [
      makeRow('a', 'Does something cool'),
      makeRow('b', 'Does something boring'),
      makeRow('c', undefined)
    ];
    const result = pageMarketplaceRows(rows, { page: 1, pageSize: 50, query: 'COOL' });
    assert.strictEqual(result.totalCount, 1);
    assert.strictEqual(result.rows[0].name, 'a');
  });

  it('AC2c: query trims whitespace before matching', () => {
    const rows = [makeRow('AlphaTool'), makeRow('beta')];
    const result = pageMarketplaceRows(rows, { page: 1, pageSize: 50, query: '  alpha  ' });
    assert.strictEqual(result.totalCount, 1);
  });

  it('AC2d: pageCount reflects filtered set', () => {
    const rows = manyRows(120);
    // Only rows with "001" in name match.
    const result = pageMarketplaceRows(rows, { page: 1, pageSize: 50, query: '001' });
    assert.strictEqual(result.totalCount, 1);
    assert.strictEqual(result.pageCount, 1);
  });

  it('AC2e: empty query returns all rows (no filter)', () => {
    const rows = [makeRow('a'), makeRow('b'), makeRow('c')];
    const result = pageMarketplaceRows(rows, { page: 1, pageSize: 50, query: '' });
    assert.strictEqual(result.totalCount, 3);
  });
});

// ---------------------------------------------------------------------------
// AC3: page clamping
// ---------------------------------------------------------------------------

describe('pageMarketplaceRows -- AC3: page clamping', () => {
  it('AC3a: page < 1 -> clamped to 1', () => {
    const result = pageMarketplaceRows(manyRows(10), { page: 0, pageSize: 5, query: '' });
    assert.strictEqual(result.page, 1);
  });

  it('AC3b: page > pageCount -> clamped to pageCount', () => {
    const result = pageMarketplaceRows(manyRows(10), { page: 99, pageSize: 5, query: '' });
    assert.strictEqual(result.page, 2); // ceil(10/5)=2
  });

  it('AC3c: non-finite page (NaN) -> 1', () => {
    const result = pageMarketplaceRows(manyRows(10), { page: NaN, pageSize: 5, query: '' });
    assert.strictEqual(result.page, 1);
  });

  it('AC3d: non-finite page (Infinity) -> 1', () => {
    const result = pageMarketplaceRows(manyRows(10), { page: Infinity, pageSize: 5, query: '' });
    assert.strictEqual(result.page, 1);
  });

  it('AC3e: negative Infinity -> 1', () => {
    const result = pageMarketplaceRows(manyRows(10), { page: -Infinity, pageSize: 5, query: '' });
    assert.strictEqual(result.page, 1);
  });

  it('AC3f: fractional page is truncated then clamped', () => {
    // trunc(1.9) = 1, valid for 2 pages of 5 from 10
    const result = pageMarketplaceRows(manyRows(10), { page: 1.9, pageSize: 5, query: '' });
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.rows[0].name, 'plugin-001');
  });
});

// ---------------------------------------------------------------------------
// AC4: boundary slices
// ---------------------------------------------------------------------------

describe('pageMarketplaceRows -- AC4: boundary slices', () => {
  it('AC4a: 120 rows/size 50 -> page 3 has 20 rows', () => {
    const result = pageMarketplaceRows(manyRows(120), { page: 3, pageSize: 50, query: '' });
    assert.strictEqual(result.rows.length, 20);
    assert.strictEqual(result.rows[0].name, 'plugin-101');
  });

  it('AC4b: exact multiple (100 rows, size 50) -> last page full (50 rows)', () => {
    const result = pageMarketplaceRows(manyRows(100), { page: 2, pageSize: 50, query: '' });
    assert.strictEqual(result.rows.length, 50);
    assert.strictEqual(result.pageCount, 2);
  });

  it('AC4c: empty rows -> [] with pageCount 1 and totalCount 0', () => {
    const result = pageMarketplaceRows([], { page: 1, pageSize: 50, query: '' });
    assert.deepStrictEqual(result.rows, []);
    assert.strictEqual(result.pageCount, 1);
    assert.strictEqual(result.totalCount, 0);
  });

  it('AC4d: pageSize < 1 -> treated as 1', () => {
    const result = pageMarketplaceRows([makeRow('a'), makeRow('b')], { page: 1, pageSize: 0, query: '' });
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.pageCount, 2);
  });

  it('AC4e: pageSize = -5 -> treated as 1', () => {
    const result = pageMarketplaceRows([makeRow('a'), makeRow('b')], { page: 2, pageSize: -5, query: '' });
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].name, 'b');
  });
});
