const SHELL_META = /[;&|`$()<>\n\r]/;

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
