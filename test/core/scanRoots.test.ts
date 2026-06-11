import * as assert from 'assert';
import * as path from 'path';
import { buildScanRoots } from '../../src/core/scanRoots';
import { AssetScope } from '../../src/core/types';

describe('buildScanRoots -- scope classification', () => {
  it('returns a root for the global .claude dir with Global scope', () => {
    const roots = buildScanRoots('/home/user/.claude', [], []);
    const global = roots.find(r => r.scope === AssetScope.Global);
    assert.ok(global, 'expected a Global-scoped root');
    assert.strictEqual(global.path, '/home/user/.claude');
  });

  it('returns a Plugin-scoped root pointing at plugins/cache (installed only)', () => {
    const roots = buildScanRoots('/home/user/.claude', [], []);
    const plugin = roots.find(r => r.scope === AssetScope.Plugin);
    assert.ok(plugin, 'expected a Plugin-scoped root');
    // buildScanRoots uses path.join, so the separator is platform-specific.
    assert.ok(plugin.path.endsWith(path.join('plugins', 'cache')), `plugin root should point to plugins/cache, got: ${plugin.path}`);
  });

  it('returns Project-scoped roots for workspace dirs', () => {
    const roots = buildScanRoots('/home/user/.claude', [], ['/workspace/myproject']);
    const project = roots.find(r => r.scope === AssetScope.Project);
    assert.ok(project, 'expected a Project-scoped root');
    assert.strictEqual(project.path, '/workspace/myproject');
  });

  it('returns Registered-scoped roots for registered dirs', () => {
    const roots = buildScanRoots('/home/user/.claude', ['/registered/dir'], []);
    const registered = roots.find(r => r.scope === AssetScope.Registered);
    assert.ok(registered, 'expected a Registered-scoped root');
    assert.strictEqual(registered.path, '/registered/dir');
  });

  it('returns a Memory-scoped or Global-scoped root for projects/*/memory', () => {
    const roots = buildScanRoots('/home/user/.claude', [], []);
    // Memory is discovered under the global root; buildScanRoots includes a memory root
    const memRoot = roots.find(r => r.path.includes('projects'));
    assert.ok(memRoot, 'expected a memory/projects root');
  });

  it('handles empty registered and workspace dirs', () => {
    const roots = buildScanRoots('/home/user/.claude', [], []);
    assert.ok(roots.length >= 1, 'should always have at least the global root');
  });
});
