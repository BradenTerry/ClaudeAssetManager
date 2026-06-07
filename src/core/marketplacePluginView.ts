import { InstalledPluginInfo, CatalogPlugin, isOutdated } from './pluginMetadata';

/** A single row in the Plugin Manager panel for a given marketplace. */
export interface MarketplacePluginRow {
  id: string;
  name: string;
  version: string;
  description?: string;
  installed: boolean;
  /** undefined when not installed; true/false when installed */
  enabled?: boolean;
  outdated: boolean;
}

/**
 * Build a sorted list of plugin rows for the given marketplace.
 *
 * Takes the union (by id) of catalog entries and installed entries whose
 * marketplace matches. Installed map is keyed by name; id->info index is
 * built from map values.
 *
 * @param marketplace - marketplace name or "" for local
 * @param installed   - map from plugin name to InstalledPluginInfo
 * @param catalog     - full catalog array (all marketplaces)
 * @param enabled     - map from plugin id to enabled boolean
 * @param catalogVersions - map from plugin name to catalog version string
 */
export function buildMarketplacePluginRows(
  marketplace: string,
  installed: Map<string, InstalledPluginInfo>,
  catalog: CatalogPlugin[],
  enabled: Map<string, boolean>,
  catalogVersions: Map<string, string>
): MarketplacePluginRow[] {
  // Build id->InstalledPluginInfo index from installed map values.
  const installedById = new Map<string, InstalledPluginInfo>();
  for (const info of installed.values()) {
    if (info.marketplace === marketplace) {
      installedById.set(info.id, info);
    }
  }

  // Collect all ids for this marketplace.
  const allIds = new Map<string, { catalogEntry?: CatalogPlugin; installedInfo?: InstalledPluginInfo }>();

  // From catalog.
  for (const p of catalog) {
    if (p.marketplace !== marketplace) continue;
    const entry = allIds.get(p.id) ?? {};
    entry.catalogEntry = p;
    allIds.set(p.id, entry);
  }

  // From installed (already filtered by marketplace above).
  for (const [id, info] of installedById) {
    const entry = allIds.get(id) ?? {};
    entry.installedInfo = info;
    allIds.set(id, entry);
  }

  const rows: MarketplacePluginRow[] = [];

  for (const [id, { catalogEntry, installedInfo }] of allIds) {
    const name = catalogEntry?.name ?? installedInfo!.name;

    // Version: catalog version if non-empty, else installed version (null -> ""), else "".
    const catalogVer = catalogEntry?.version ?? '';
    let version: string;
    if (catalogVer) {
      version = catalogVer;
    } else if (installedInfo) {
      version = installedInfo.version ?? '';
    } else {
      version = '';
    }

    const description = catalogEntry?.description;
    const isInstalled = installedInfo !== undefined;
    const isEnabled = isInstalled ? (enabled.get(id) ?? false) : undefined;
    const outdated = isInstalled
      ? isOutdated(installedInfo!, catalogVersions.get(name))
      : false;

    rows.push({ id, name, version, description, installed: isInstalled, enabled: isEnabled, outdated });
  }

  // Sort by name case-insensitive, stable.
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return rows;
}

/** Result of paginating (and optionally filtering) a marketplace row list. */
export interface PagedRows {
  /** Rows for the current page slice. */
  rows: MarketplacePluginRow[];
  /** Clamped 1-based page number. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** Total rows after filtering (before slicing). */
  totalCount: number;
}

/**
 * Filter rows by query and return a single page slice.
 *
 * @param rows     - full sorted row list for the marketplace
 * @param opts.page     - requested 1-based page (clamped; non-finite -> 1)
 * @param opts.pageSize - rows per page; values < 1 are treated as 1
 * @param opts.query    - search string; trimmed, case-insensitive; "" = no filter
 */
export function pageMarketplaceRows(
  rows: MarketplacePluginRow[],
  opts: { page: number; pageSize: number; query: string }
): PagedRows {
  const effectivePageSize = opts.pageSize < 1 ? 1 : Math.trunc(opts.pageSize);
  const q = opts.query.trim().toLowerCase();

  const filtered = q
    ? rows.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    : rows;

  const totalCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / effectivePageSize));

  let page: number;
  if (!Number.isFinite(opts.page)) {
    page = 1;
  } else {
    page = Math.min(Math.max(Math.trunc(opts.page), 1), pageCount);
  }

  const start = (page - 1) * effectivePageSize;
  return {
    rows: filtered.slice(start, start + effectivePageSize),
    page,
    pageCount,
    totalCount
  };
}
