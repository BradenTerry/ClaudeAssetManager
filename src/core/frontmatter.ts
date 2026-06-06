import { parse as parseYaml } from 'yaml';

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Frontmatter is delimited by lines containing only `---`.
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  if (!text) {
    return { data: {}, body: '' };
  }

  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = text.match(frontmatterRegex);

  if (!match) {
    return { data: {}, body: text };
  }

  const yamlStr = match[1];
  const body = match[2] ?? '';

  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }

  return { data, body };
}
