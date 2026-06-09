import * as fs from 'fs';

export interface MarketplaceInfo {
  name: string;
  installLocation: string; // '' when absent
  lastUpdated: string;     // '' when absent
}

/** Read ~/.claude/plugins/known_marketplaces.json (top-level object keyed by name). Empty Map on any failure. */
export function readKnownMarketplaces(filePath: string): Map<string, MarketplaceInfo> {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return new Map();
    const result = new Map<string, MarketplaceInfo>();
    for (const [name, val] of Object.entries(data)) {
      if (!name || !val || typeof val !== 'object' || Array.isArray(val)) continue;
      const v = val as Record<string, unknown>;
      result.set(name, {
        name,
        installLocation: typeof v['installLocation'] === 'string' ? v['installLocation'] : '',
        lastUpdated: typeof v['lastUpdated'] === 'string' ? v['lastUpdated'] : ''
      });
    }
    return result;
  } catch { return new Map(); }
}

export interface InstalledPluginInfo {
  name: string;
  /** Full identifier "name@marketplace" (the installed_plugins.json key); passed to `claude plugin update` */
  id: string;
  /** Marketplace portion of the key, or "" when the key has no @ */
  marketplace: string;
  /** Semantic version string, or null when unknown (field absent, or the
   *  installer's literal "unknown" placeholder for a plugin.json with no version) */
  version: string | null;
  /** Absolute path to the cache copy of the plugin, e.g. ~/.claude/plugins/cache/<mk>/<plugin>/<version> */
  installPath: string;
  /** ISO timestamp string from the lastUpdated field */
  lastUpdated: string;
  /** Install scope from installed_plugins.json. Defaults to 'user' when absent or unrecognized. */
  scope: 'user' | 'project' | 'local';
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
      // The installer writes the literal "unknown" when a plugin.json declares
      // no version; treat that (and an absent field) as null so consumers only
      // ever check for null, never a magic string.
      const rawVersion = typeof entry['version'] === 'string' ? entry['version'] : '';
      const version = rawVersion && rawVersion !== 'unknown' ? rawVersion : null;
      const lastUpdated = typeof entry['lastUpdated'] === 'string' ? entry['lastUpdated'] : '';
      const rawScope = entry['scope'];
      const scope: 'user' | 'project' | 'local' =
        rawScope === 'project' || rawScope === 'local' ? rawScope : 'user';

      result.set(name, { name, id: key, marketplace, version, installPath, lastUpdated, scope });
    }
    return result;
  } catch {
    return new Map();
  }
}

export interface CatalogPlugin {
  id: string;           // full "name@marketplace" key
  name: string;         // part before @ (or `plugin` field)
  marketplace: string;  // part after @, or ''
  version: string;      // '' when absent
  description?: string; // from marketplace_entry.description
}

/**
 * Read ~/.claude/plugins/plugin-catalog-cache.json and return an array of
 * CatalogPlugin entries, one per key in catalog.plugins.
 *
 * Returns an empty array if the file is missing, unreadable, malformed, or has
 * no catalog.plugins object.
 */
export function readCatalogPlugins(filePath: string): CatalogPlugin[] {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const catalog = data['catalog'];
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return [];
    const plugins = (catalog as Record<string, unknown>)['plugins'];
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
    const out: CatalogPlugin[] = [];
    for (const [key, entry] of Object.entries(plugins as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const atIdx = key.indexOf('@');
      const nameFromKey = atIdx !== -1 ? key.slice(0, atIdx) : key;
      const marketplace = atIdx !== -1 ? key.slice(atIdx + 1) : '';
      const name = typeof e['plugin'] === 'string' && e['plugin'] ? e['plugin'] as string : nameFromKey;
      if (!name) continue;
      const version = typeof e['version'] === 'string' ? e['version'] as string : '';
      const me = e['marketplace_entry'];
      const description = (me && typeof me === 'object' && !Array.isArray(me) && typeof (me as Record<string, unknown>)['description'] === 'string')
        ? (me as Record<string, unknown>)['description'] as string
        : undefined;
      out.push({ id: key, name, marketplace, version, description });
    }
    return out;
  } catch { return []; }
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

/**
 * Read ~/.claude/settings.json enabledPlugins map (id -> boolean). Empty Map on any failure.
 * Only entries whose value is a boolean are included; missing file, bad JSON, or no
 * enabledPlugins key all return an empty Map.
 */
export function readEnabledPlugins(filePath: string): Map<string, boolean> {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const ep = data['enabledPlugins'];
    if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return new Map();
    const result = new Map<string, boolean>();
    for (const [id, val] of Object.entries(ep as Record<string, unknown>)) {
      if (typeof val === 'boolean') result.set(id, val);
    }
    return result;
  } catch { return new Map(); }
}

/**
 * Remove enabledPlugins[id] from a settings JSON file. Returns true when an entry was removed.
 * Defensive: missing file, unreadable, non-JSON, no enabledPlugins object, or absent id -> false,
 * no write. Preserves sibling keys; writes 2-space-indented JSON with a trailing newline.
 */
export function removeEnabledPluginEntry(settingsPath: string, id: string): boolean {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const ep = data['enabledPlugins'];
    if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return false;
    const obj = ep as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, id)) return false;
    delete obj[id];
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

export type PluginScope = 'project' | 'local';

export interface ProjectPluginEnablement {
  enabled: boolean;
  scope: PluginScope;
}

/** Parse enabledPlugins from a single settings file. Returns an empty Map on any failure. */
function parseEnabledPluginsFromFile(filePath: string): Map<string, boolean> {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const ep = data['enabledPlugins'];
    if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return new Map();
    const result = new Map<string, boolean>();
    for (const [id, val] of Object.entries(ep as Record<string, unknown>)) {
      if (typeof val === 'boolean') result.set(id, val);
    }
    return result;
  } catch { return new Map(); }
}

/**
 * Merge enabledPlugins from a project's settings.json (scope 'project') and
 * settings.local.json (scope 'local'). settings.local wins on conflicting ids and
 * the surviving entry carries scope 'local'.
 * Each file is read defensively (empty contribution on any failure / non-boolean value).
 */
export function readProjectEnabledPlugins(
  settingsPath: string,
  settingsLocalPath: string
): Map<string, ProjectPluginEnablement> {
  const projectMap = parseEnabledPluginsFromFile(settingsPath);
  const localMap = parseEnabledPluginsFromFile(settingsLocalPath);

  const result = new Map<string, ProjectPluginEnablement>();
  for (const [id, enabled] of projectMap) {
    result.set(id, { enabled, scope: 'project' });
  }
  // local wins: overlay and mark as 'local'
  for (const [id, enabled] of localMap) {
    result.set(id, { enabled, scope: 'local' });
  }
  return result;
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
 * and the catalog version is strictly newer.
 *
 * Version-less plugins (installed version null or no catalog version) carry no
 * reliable update signal, so they are never flagged -- this avoids the
 * permanent false positive that a timestamp comparison would produce.
 */
export function isOutdated(installed: InstalledPluginInfo, catalogVersion: string | undefined): boolean {
  const iv = installed.version;
  if (!iv) return false;
  if (!catalogVersion || catalogVersion === 'unknown') return false;
  return compareVersions(catalogVersion, iv) > 0;
}
