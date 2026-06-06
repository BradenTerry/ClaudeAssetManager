import * as assert from 'assert';
import { normalizeMarkdownOpenMode } from '../../src/core/markdownOpen';

describe('normalizeMarkdownOpenMode -- AC-MD-1', () => {
  it("returns 'code' for 'code'", () => {
    assert.strictEqual(normalizeMarkdownOpenMode('code'), 'code');
  });

  it("returns 'preview' for 'preview'", () => {
    assert.strictEqual(normalizeMarkdownOpenMode('preview'), 'preview');
  });

  it("returns 'split' for 'split'", () => {
    assert.strictEqual(normalizeMarkdownOpenMode('split'), 'split');
  });

  it("returns 'default' for undefined", () => {
    assert.strictEqual(normalizeMarkdownOpenMode(undefined), 'default');
  });

  it("returns 'default' for null", () => {
    assert.strictEqual(normalizeMarkdownOpenMode(null), 'default');
  });

  it("returns 'default' for empty string", () => {
    assert.strictEqual(normalizeMarkdownOpenMode(''), 'default');
  });

  it("returns 'default' for 'Default' (wrong case)", () => {
    assert.strictEqual(normalizeMarkdownOpenMode('Default'), 'default');
  });

  it("returns 'default' for arbitrary unknown string 'foo'", () => {
    assert.strictEqual(normalizeMarkdownOpenMode('foo'), 'default');
  });

  it("returns 'default' for a number (123)", () => {
    assert.strictEqual(normalizeMarkdownOpenMode(123), 'default');
  });

  it("returns 'default' for 'default' itself", () => {
    assert.strictEqual(normalizeMarkdownOpenMode('default'), 'default');
  });
});
