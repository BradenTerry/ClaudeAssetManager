const SHELL_META = /[;&|`$()<>\n\r]/;

/** The set of allowed scopes for plugin CLI operations. */
export type PluginInstallScope = 'user' | 'project' | 'local';

/**
 * Returns the scope string when it is one of the three allowed values,
 * or undefined for any other input (including non-strings).
 */
export function normalizePluginScope(raw: unknown): PluginInstallScope | undefined {
  return raw === 'user' || raw === 'project' || raw === 'local' ? raw : undefined;
}

/**
 * Build the CLI args array for a scoped plugin operation.
 * Returns ['plugin', op, id, '--scope', scope].
 */
export function buildScopedPluginArgs(
  op: 'install' | 'enable' | 'disable' | 'uninstall',
  id: string,
  scope: PluginInstallScope
): string[] {
  return ['plugin', op, id, '--scope', scope];
}

/**
 * Parse the conflicting scope from a CLI "is enabled at <scope> scope" error message.
 * Returns the scope string ('user'|'project'|'local') or undefined when the output
 * does not contain that phrase (including non-string input).
 */
export function parseEnabledScopeConflict(output: string): PluginInstallScope | undefined {
  if (typeof output !== 'string') return undefined;
  const m = output.match(/enabled at (user|project|local) scope/i);
  return m ? (m[1].toLowerCase() as PluginInstallScope) : undefined;
}

/** Returns true when id is a non-empty string containing only alphanumerics and ._@/+- */
export function isValidPluginId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && /^[A-Za-z0-9._@/+-]+$/.test(id);
}

/** Returns true when name is a non-empty string containing only alphanumerics and ._-  (no parens, so "(local)" is rejected) */
export function isValidMarketplaceName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && /^[A-Za-z0-9._-]+$/.test(name);
}

/** Returns true when src is a non-empty (after trim) string with no shell metacharacters. */
export function isSafeMarketplaceSource(src: string): boolean {
  return typeof src === 'string' && src.trim().length > 0 && !SHELL_META.test(src);
}

/** One entry per scope where the plugin is present (installed or has an enabledPlugins entry). */
export interface PluginScopePresence {
  scope: PluginInstallScope;
  /** True when this scope is the plugin's install scope. */
  installed: boolean;
  /** True when the scope's enabledPlugins map contains the id (regardless of value). */
  enabled: boolean;
}

/**
 * Returns an entry for each scope where the plugin id is present:
 * - installed: scope === installScope
 * - enabled: the scope's enabledPlugins map has(id)
 * Scopes with neither installed nor enabled are omitted.
 */
export function computePluginScopePresence(
  id: string,
  installScope: PluginInstallScope | undefined,
  userEnabled: Map<string, boolean>,
  teamEnabled: Map<string, boolean>,
  localEnabled: Map<string, boolean>
): PluginScopePresence[] {
  const scopeMaps: Array<{ scope: PluginInstallScope; map: Map<string, boolean> }> = [
    { scope: 'user', map: userEnabled },
    { scope: 'project', map: teamEnabled },
    { scope: 'local', map: localEnabled }
  ];
  const result: PluginScopePresence[] = [];
  for (const { scope, map } of scopeMaps) {
    const installed = scope === installScope;
    const enabled = map.has(id);
    if (installed || enabled) {
      result.push({ scope, installed, enabled });
    }
  }
  return result;
}
