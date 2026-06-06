export type MarkdownOpenMode = 'default' | 'code' | 'preview' | 'split';

/** Normalize a raw setting value to a known mode; anything unexpected -> 'default'. */
export function normalizeMarkdownOpenMode(value: unknown): MarkdownOpenMode {
  return value === 'code' || value === 'preview' || value === 'split' ? value : 'default';
}
