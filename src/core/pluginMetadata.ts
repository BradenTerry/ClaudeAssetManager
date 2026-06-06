import * as fs from 'fs';

export interface InstalledPluginInfo {
  name: string;
  /** Full identifier "name@marketplace" (the installed_plugins.json key); passed to `claude plugin update` */
  id: string;
  /** Marketplace portion of the key, or "" when the key has no @ */
  marketplace: string;
  /** Semantic version string, or "unknown" */
  version: string;
  /** Absolute path to the cache copy of the plugin, e.g. ~/.claude/plugins/cache/<mk>/<plugin>/<version> */
  installPath: string;
  /** ISO timestamp string from the lastUpdated field */
  lastUpdated: string;
}

/**
 * Read ~/.claude/plugins/installed_plugins.json and return a map from
 * plugin name (the part before @ in the key) to InstalledPluginInfo.
 *
 * Uses the first entry in each plugin's array.
 * Returns an empty Map if the file is missing, unreadable, or malformed.
 */
export function readInstalledPlugins(filePath: string): Map<string, InstalledPluginInfo> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    const plugins = data['plugins'];
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
      return new Map();
    }

    const result = new Map<string, InstalledPluginInfo>();
    for (const [key, entries] of Object.entries(plugins as Record<string, unknown>)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const entry = entries[0] as Record<string, unknown>;
      if (!entry || typeof entry !== 'object') continue;

      const atIdx = key.indexOf('@');
      const name = atIdx !== -1 ? key.slice(0, atIdx) : key;
      if (!name) continue;
      const marketplace = atIdx !== -1 ? key.slice(atIdx + 1) : '';

      const installPath = typeof entry['installPath'] === 'string' ? entry['installPath'] : '';
      const version = typeof entry['version'] === 'string' ? entry['version'] : 'unknown';
      const lastUpdated = typeof entry['lastUpdated'] === 'string' ? entry['lastUpdated'] : '';

      result.set(name, { name, id: key, marketplace, version, installPath, lastUpdated });
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Read ~/.claude/plugins/plugin-catalog-cache.json and return a map from
 * plugin name to the catalog's published `version` string.
 *
 * The catalog's `last_updated` field tracks marketplace-metadata churn and is
 * unrelated to whether the user's install is behind, so version is the only
 * reliable "what's the latest" signal. Returns an empty Map if the file is
 * missing, unreadable, or malformed.
 */
export function readCatalogVersions(filePath: string): Map<string, string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    const catalog = data['catalog'];
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
      return new Map();
    }

    const catalogPlugins = (catalog as Record<string, unknown>)['plugins'];
    if (!catalogPlugins || typeof catalogPlugins !== 'object' || Array.isArray(catalogPlugins)) {
      return new Map();
    }

    const result = new Map<string, string>();
    for (const [key, entry] of Object.entries(catalogPlugins as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

      const atIdx = key.indexOf('@');
      const name = atIdx !== -1 ? key.slice(0, atIdx) : key;
      if (!name) continue;

      const version = (entry as Record<string, unknown>)['version'];
      if (typeof version === 'string' && version) {
        result.set(name, version);
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

/** Compare two dotted numeric version strings. Returns >0 if a is newer than b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Returns true only when both the installed and catalog versions are concrete
 * (present and not "unknown") and the catalog version is strictly newer.
 *
 * Version-less plugins (installed "unknown" or no catalog version) carry no
 * reliable update signal, so they are never flagged -- this avoids the
 * permanent false positive that a timestamp comparison would produce.
 */
export function isOutdated(installed: InstalledPluginInfo, catalogVersion: string | undefined): boolean {
  const iv = installed.version;
  if (!iv || iv === 'unknown') return false;
  if (!catalogVersion || catalogVersion === 'unknown') return false;
  return compareVersions(catalogVersion, iv) > 0;
}
