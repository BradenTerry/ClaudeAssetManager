import * as fs from 'fs';

export interface InstalledPluginInfo {
  name: string;
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

      const installPath = typeof entry['installPath'] === 'string' ? entry['installPath'] : '';
      const version = typeof entry['version'] === 'string' ? entry['version'] : 'unknown';
      const lastUpdated = typeof entry['lastUpdated'] === 'string' ? entry['lastUpdated'] : '';

      result.set(name, { name, version, installPath, lastUpdated });
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Read ~/.claude/plugins/plugin-catalog-cache.json and return a map from
 * plugin name to the catalog's last_updated timestamp string.
 *
 * Returns an empty Map if the file is missing, unreadable, or malformed.
 */
export function readCatalogLastUpdated(filePath: string): Map<string, string> {
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

      const lastUpdated = (entry as Record<string, unknown>)['last_updated'];
      if (typeof lastUpdated === 'string' && lastUpdated) {
        result.set(name, lastUpdated);
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Returns true when the catalog has a newer last_updated timestamp than the
 * plugin's installed lastUpdated. Returns false when either timestamp is
 * missing, unparseable, or catalogLastUpdated <= installed.lastUpdated.
 */
export function isOutdated(installed: InstalledPluginInfo, catalogLastUpdated: string | undefined): boolean {
  if (!catalogLastUpdated) return false;

  const installedTs = new Date(installed.lastUpdated).getTime();
  const catalogTs = new Date(catalogLastUpdated).getTime();

  if (isNaN(installedTs) || isNaN(catalogTs)) return false;

  return catalogTs > installedTs;
}
