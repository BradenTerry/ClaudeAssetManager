import * as assert from 'assert';
import { parseFrontmatter } from '../../src/core/frontmatter';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and returns data + body', () => {
    const text = `---
name: my-skill
description: Does something useful
allowed-tools:
  - Bash
  - Read
---

# Body content here
`;
    const result = parseFrontmatter(text);
    assert.strictEqual(result.data['name'], 'my-skill');
    assert.strictEqual(result.data['description'], 'Does something useful');
    assert.deepStrictEqual(result.data['allowed-tools'], ['Bash', 'Read']);
    assert.ok(result.body.includes('# Body content here'));
  });

  it('returns empty data and full text when no frontmatter present', () => {
    const text = '# Just a markdown file\nNo frontmatter here.';
    const result = parseFrontmatter(text);
    assert.deepStrictEqual(result.data, {});
    assert.ok(result.body.includes('Just a markdown file'));
  });

  it('handles empty file', () => {
    const result = parseFrontmatter('');
    assert.deepStrictEqual(result.data, {});
    assert.strictEqual(result.body, '');
  });

  it('handles frontmatter with no body', () => {
    const text = `---
name: minimal
---
`;
    const result = parseFrontmatter(text);
    assert.strictEqual(result.data['name'], 'minimal');
  });
});
