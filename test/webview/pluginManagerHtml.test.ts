import * as assert from 'assert';
import { renderPluginManagerHtml, escapeHtml, PluginManagerViewModel } from '../../src/webview/pluginManagerHtml';
import { MarketplacePluginRow } from '../../src/core/marketplacePluginView';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    assert.strictEqual(escapeHtml('&<>"\' test'), '&amp;&lt;&gt;&quot;&#39; test');
  });

  it('returns plain string unchanged', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world');
  });
});

// ---------------------------------------------------------------------------
// AC10: HTML builder output
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC10', () => {
  const nonce = 'testnonce123';
  const cspSource = 'vscode-webview://test-host';

  function makeRow(overrides: Partial<MarketplacePluginRow> = {}): MarketplacePluginRow {
    return {
      id: 'foo@mk',
      name: 'Foo Plugin',
      version: '1.0.0',
      description: 'A useful tool',
      installed: false,
      enabled: undefined,
      outdated: false,
      ...overrides
    };
  }

  const baseVm: PluginManagerViewModel = {
    marketplaces: [
      { value: 'mk', label: 'mk' },
      { value: '', label: '(local)' }
    ],
    selected: 'mk',
    rows: [makeRow()],
    page: 1,
    pageCount: 1,
    totalCount: 1,
    query: '',
    scope: 'user',
    projectScopeAvailable: false
  };

  it('AC10a: each row name appears (escaped) in output', () => {
    const html = renderPluginManagerHtml(baseVm, { nonce, cspSource });
    assert.ok(html.includes('Foo Plugin'), 'row name should appear in output');
  });

  it('AC10b: selected marketplace option is marked selected', () => {
    const html = renderPluginManagerHtml(baseVm, { nonce, cspSource });
    // The selected option for 'mk' should have the selected attribute
    // while the '' option should NOT have it
    assert.ok(html.includes('value="mk" selected'), 'mk option should be marked selected');
    assert.ok(!html.includes('value="" selected'), '"" option should not be selected');
  });

  it('AC10b-alt: when "" is selected, it is marked selected and mk is not', () => {
    const vm: PluginManagerViewModel = { ...baseVm, selected: '' };
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(html.includes('value="" selected'), '"" option should be marked selected');
    assert.ok(!html.includes('value="mk" selected'), 'mk option should not be selected');
  });

  it('AC10c: "(local)" label is rendered for the "" option', () => {
    const html = renderPluginManagerHtml(baseVm, { nonce, cspSource });
    assert.ok(html.includes('(local)'), '(local) label should appear in html');
  });

  it('AC10d: injection in name is escaped -- raw <script> does not appear from data', () => {
    const maliciousRow = makeRow({ name: '<script>alert(1)</script>', id: 'bad@mk' });
    const vm: PluginManagerViewModel = { ...baseVm, rows: [maliciousRow] };
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    // The literal string <script>alert(1)</script> from the data must not appear raw
    // (the inline script tag is fine but the data-injected one must be escaped)
    // We check that the raw name is not in the output
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag from data must not appear');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped form should appear');
  });

  it('AC10e: injection in description is escaped', () => {
    const maliciousRow = makeRow({ description: '<img src=x onerror="alert(1)">', id: 'bad@mk' });
    const vm: PluginManagerViewModel = { ...baseVm, rows: [maliciousRow] };
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(!html.includes('<img src=x onerror="alert(1)">'), 'raw img tag from description must not appear');
  });

  it('AC10f: injection in version is escaped -- raw quote cannot break attribute context', () => {
    // version with an embedded quote and script; must not appear raw in the output
    const maliciousRow = makeRow({ version: '<b>1.0.0</b>', id: 'bad@mk' });
    const vm: PluginManagerViewModel = { ...baseVm, rows: [maliciousRow] };
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    // Raw < from version data must not appear unescaped
    // (we check the specific data string, not accidentally matching other HTML)
    assert.ok(!html.includes('<b>1.0.0</b>'), 'raw html tags from version data must not appear unescaped');
    assert.ok(html.includes('&lt;b&gt;'), 'escaped form of version data should be present');
  });
});

// ---------------------------------------------------------------------------
// AC11: nonce + CSP
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC11: nonce and CSP', () => {
  const nonce = 'mynonce42';
  const cspSource = 'vscode-webview://test-host';

  const vm: PluginManagerViewModel = {
    marketplaces: [{ value: 'mk', label: 'mk' }],
    selected: 'mk',
    rows: [],
    page: 1,
    pageCount: 1,
    totalCount: 0,
    query: '',
    scope: 'user',
    projectScopeAvailable: false
  };

  it('AC11a: nonce appears on inline <script> tag', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes(`<script nonce="${nonce}">`),
      'inline script should carry the nonce attribute'
    );
  });

  it('AC11b: nonce appears in CSP meta tag', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes(`'nonce-${nonce}'`),
      'CSP meta should contain nonce-<nonce>'
    );
  });

  it('AC11c: cspSource appears in CSP meta tag', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes(cspSource),
      'CSP meta should reference the webview cspSource'
    );
  });

  it('AC11d: CSP meta tag is present', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes('<meta http-equiv="Content-Security-Policy"'),
      'CSP meta tag should be present'
    );
  });
});

// ---------------------------------------------------------------------------
// AC1-AC3: Remove Marketplace button
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- Remove Marketplace button', () => {
  const nonce = 'testnonce999';
  const cspSource = 'vscode-webview://test-host';

  const vmWithMarketplace: PluginManagerViewModel = {
    marketplaces: [
      { value: 'mymk', label: 'mymk' },
      { value: '', label: '(local)' }
    ],
    selected: 'mymk',
    rows: [],
    page: 1,
    pageCount: 1,
    totalCount: 0,
    query: '',
    scope: 'user',
    projectScopeAvailable: false
  };

  const vmLocalSelected: PluginManagerViewModel = {
    ...vmWithMarketplace,
    selected: ''
  };

  it('AC1: rendered HTML contains a button with id remove-marketplace-btn and text "Remove Marketplace"', () => {
    const html = renderPluginManagerHtml(vmWithMarketplace, { nonce, cspSource });
    assert.ok(
      html.includes('id="remove-marketplace-btn"'),
      'button id remove-marketplace-btn must be present'
    );
    assert.ok(
      html.includes('Remove Marketplace'),
      'button text "Remove Marketplace" must be present'
    );
  });

  it('AC2a: remove button includes "disabled" when vm.selected === ""', () => {
    const html = renderPluginManagerHtml(vmLocalSelected, { nonce, cspSource });
    // The button element containing remove-marketplace-btn must carry disabled
    const btnMatch = html.match(/<button[^>]*id="remove-marketplace-btn"[^>]*>/);
    assert.ok(btnMatch, 'remove-marketplace-btn element must be present');
    assert.ok(
      btnMatch![0].includes('disabled'),
      'remove button must be disabled when local marketplace is selected'
    );
  });

  it('AC2b: remove button does NOT include "disabled" when vm.selected is a real marketplace', () => {
    const html = renderPluginManagerHtml(vmWithMarketplace, { nonce, cspSource });
    const btnMatch = html.match(/<button[^>]*id="remove-marketplace-btn"[^>]*>/);
    assert.ok(btnMatch, 'remove-marketplace-btn element must be present');
    assert.ok(
      !btnMatch![0].includes('disabled'),
      'remove button must not be disabled when a real marketplace is selected'
    );
  });

  it('AC3: inline script contains removeMarketplace postMessage wiring on remove-marketplace-btn', () => {
    const html = renderPluginManagerHtml(vmWithMarketplace, { nonce, cspSource });
    assert.ok(
      html.includes('remove-marketplace-btn'),
      'script must reference remove-marketplace-btn'
    );
    assert.ok(
      html.includes("'removeMarketplace'") || html.includes('"removeMarketplace"'),
      'script must post type removeMarketplace'
    );
  });
});

// ---------------------------------------------------------------------------
// AC5: search input value + autofocus
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC5: search input', () => {
  const nonce = 'ac5nonce';
  const cspSource = 'vscode-webview://test';

  function makeVm(query: string): PluginManagerViewModel {
    return {
      marketplaces: [{ value: 'mk', label: 'mk' }],
      selected: 'mk',
      rows: [],
      page: 1,
      pageCount: 1,
      totalCount: 0,
      query,
      scope: 'user',
      projectScopeAvailable: false
    };
  }

  it('AC5a: search input has value attribute set to escaped query', () => {
    const html = renderPluginManagerHtml(makeVm('hello'), { nonce, cspSource });
    assert.ok(html.includes('value="hello"'), 'search input value should match query');
  });

  it('AC5b: query with special chars is HTML-escaped in value attribute', () => {
    const html = renderPluginManagerHtml(makeVm('<evil>'), { nonce, cspSource });
    assert.ok(html.includes('value="&lt;evil&gt;"'), 'query must be escaped in value attr');
    assert.ok(!html.includes('value="<evil>"'), 'raw unescaped value must not appear');
  });

  it('AC5c: autofocus present when query is non-empty', () => {
    const html = renderPluginManagerHtml(makeVm('search term'), { nonce, cspSource });
    // Find the search input element and verify autofocus is on it
    const inputMatch = html.match(/<input[^>]*id="search-input"[^>]*>/);
    assert.ok(inputMatch, 'search input must be present');
    assert.ok(inputMatch![0].includes('autofocus'), 'autofocus must be present when query is set');
  });

  it('AC5d: autofocus absent when query is empty string', () => {
    const html = renderPluginManagerHtml(makeVm(''), { nonce, cspSource });
    const inputMatch = html.match(/<input[^>]*id="search-input"[^>]*>/);
    assert.ok(inputMatch, 'search input must be present');
    assert.ok(!inputMatch![0].includes('autofocus'), 'autofocus must NOT be present when query is empty');
  });

  it('AC5e: value="" when query is empty string', () => {
    const html = renderPluginManagerHtml(makeVm(''), { nonce, cspSource });
    const inputMatch = html.match(/<input[^>]*id="search-input"[^>]*>/);
    assert.ok(inputMatch, 'search input must be present');
    assert.ok(inputMatch![0].includes('value=""'), 'value must be empty string when query is ""');
  });
});

// ---------------------------------------------------------------------------
// AC6: pagination footer
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC6: pagination footer', () => {
  const nonce = 'ac6nonce';
  const cspSource = 'vscode-webview://test';

  function makeVm(page: number, pageCount: number, totalCount: number): PluginManagerViewModel {
    return {
      marketplaces: [{ value: 'mk', label: 'mk' }],
      selected: 'mk',
      rows: [],
      page,
      pageCount,
      totalCount,
      query: '',
      scope: 'user',
      projectScopeAvailable: false
    };
  }

  it('AC6a: Prev and Next buttons present in footer', () => {
    const html = renderPluginManagerHtml(makeVm(2, 3, 150), { nonce, cspSource });
    assert.ok(html.includes('id="prev-page-btn"'), 'prev button must be present');
    assert.ok(html.includes('id="next-page-btn"'), 'next button must be present');
  });

  it('AC6b: Prev is disabled on page 1', () => {
    const html = renderPluginManagerHtml(makeVm(1, 3, 120), { nonce, cspSource });
    const prevMatch = html.match(/<button[^>]*id="prev-page-btn"[^>]*>/);
    assert.ok(prevMatch, 'prev button must be present');
    assert.ok(prevMatch![0].includes('disabled'), 'Prev must be disabled on page 1');
  });

  it('AC6c: Next is disabled on last page', () => {
    const html = renderPluginManagerHtml(makeVm(3, 3, 120), { nonce, cspSource });
    const nextMatch = html.match(/<button[^>]*id="next-page-btn"[^>]*>/);
    assert.ok(nextMatch, 'next button must be present');
    assert.ok(nextMatch![0].includes('disabled'), 'Next must be disabled on last page');
  });

  it('AC6d: Prev is NOT disabled when page > 1', () => {
    const html = renderPluginManagerHtml(makeVm(2, 3, 120), { nonce, cspSource });
    const prevMatch = html.match(/<button[^>]*id="prev-page-btn"[^>]*>/);
    assert.ok(prevMatch, 'prev button must be present');
    assert.ok(!prevMatch![0].includes('disabled'), 'Prev must NOT be disabled when page > 1');
  });

  it('AC6e: Next is NOT disabled when page < pageCount', () => {
    const html = renderPluginManagerHtml(makeVm(1, 3, 120), { nonce, cspSource });
    const nextMatch = html.match(/<button[^>]*id="next-page-btn"[^>]*>/);
    assert.ok(nextMatch, 'next button must be present');
    assert.ok(!nextMatch![0].includes('disabled'), 'Next must NOT be disabled when page < pageCount');
  });

  it('AC6f: footer shows "Page X of Y (Z)" format', () => {
    const html = renderPluginManagerHtml(makeVm(2, 3, 150), { nonce, cspSource });
    assert.ok(html.includes('Page 2 of 3'), 'footer must show page numbers');
    assert.ok(html.includes('150'), 'footer must show totalCount');
  });
});

// ---------------------------------------------------------------------------
// AC7: only provided rows appear in the list
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC7: only provided rows rendered', () => {
  const nonce = 'ac7nonce';
  const cspSource = 'vscode-webview://test';

  it('AC7: only the 2 provided row names appear; an absent name is not found', () => {
    const rowA: MarketplacePluginRow = {
      id: 'alpha@mk', name: 'AlphaTool', version: '1.0', installed: false, outdated: false
    };
    const rowB: MarketplacePluginRow = {
      id: 'beta@mk', name: 'BetaTool', version: '2.0', installed: false, outdated: false
    };
    const vm: PluginManagerViewModel = {
      marketplaces: [{ value: 'mk', label: 'mk' }],
      selected: 'mk',
      rows: [rowA, rowB],
      page: 1,
      pageCount: 3,
      totalCount: 150,
      query: '',
      scope: 'user',
      projectScopeAvailable: false
    };
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(html.includes('AlphaTool'), 'AlphaTool must appear');
    assert.ok(html.includes('BetaTool'), 'BetaTool must appear');
    assert.ok(!html.includes('GammaTool'), 'GammaTool must not appear (not in rows)');
  });
});

// ---------------------------------------------------------------------------
// AC8: script wiring for search and page messages
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC8: script wiring', () => {
  const nonce = 'ac8nonce';
  const cspSource = 'vscode-webview://test';

  const vm: PluginManagerViewModel = {
    marketplaces: [{ value: 'mk', label: 'mk' }],
    selected: 'mk',
    rows: [],
    page: 2,
    pageCount: 3,
    totalCount: 100,
    query: 'find me',
    scope: 'user',
    projectScopeAvailable: false
  };

  it('AC8a: script posts {type:\'search\'} on search input', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes("'search'") || html.includes('"search"'),
      'script must reference type search'
    );
    assert.ok(
      html.includes('search-input'),
      'script must reference search-input element'
    );
  });

  it('AC8b: script posts {type:\'page\'} on prev/next click', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes("'page'") || html.includes('"page"'),
      'script must reference type page'
    );
    assert.ok(
      html.includes('prev-page-btn'),
      'script must reference prev-page-btn'
    );
    assert.ok(
      html.includes('next-page-btn'),
      'script must reference next-page-btn'
    );
  });

  it('AC8c: search handler is debounced (setTimeout present in script)', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(html.includes('setTimeout'), 'debounce must use setTimeout');
  });

  it('AC8d: on load, focus+setSelectionRange called when query is non-empty', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(html.includes('setSelectionRange'), 'script must call setSelectionRange to restore caret');
  });
});

// ---------------------------------------------------------------------------
// AC6: scope select rendering
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC6: scope select', () => {
  const nonce = 'scopenonce';
  const cspSource = 'vscode-webview://test-host';

  function makeVmWithScope(
    scope: 'user' | 'project' | 'local',
    projectScopeAvailable: boolean
  ): PluginManagerViewModel {
    return {
      marketplaces: [{ value: 'mk', label: 'mk' }],
      selected: 'mk',
      rows: [],
      page: 1,
      pageCount: 1,
      totalCount: 0,
      query: '',
      scope,
      projectScopeAvailable
    };
  }

  it('AC6a: scope-select element present with user option always', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', false), { nonce, cspSource });
    assert.ok(html.includes('id="scope-select"'), 'scope-select element must be present');
    assert.ok(html.includes('value="user"'), 'user option must always be present');
  });

  it('AC6b: when projectScopeAvailable=false, project and local options are absent', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', false), { nonce, cspSource });
    assert.ok(!html.includes('value="project"'), 'project option must be absent when not available');
    assert.ok(!html.includes('value="local"'), 'local option must be absent when not available');
  });

  it('AC6c: when projectScopeAvailable=true, project option is present', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', true), { nonce, cspSource });
    assert.ok(html.includes('value="project"'), 'project option must be present when available');
  });

  it('AC6d: when projectScopeAvailable=true, local option is present', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', true), { nonce, cspSource });
    assert.ok(html.includes('value="local"'), 'local option must be present when available');
  });

  it('AC6e: projectScopeAvailable=false -> exactly one scope option (user)', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', false), { nonce, cspSource });
    // Count value= occurrences for scope-select options only; easier to check no project/local
    const selectMatch = html.match(/id="scope-select"[\s\S]*?<\/select>/);
    assert.ok(selectMatch, 'scope-select element should be present');
    const selectContent = selectMatch![0];
    assert.ok(selectContent.includes('value="user"'), 'user option in scope-select');
    assert.ok(!selectContent.includes('value="project"'), 'project option absent in scope-select');
    assert.ok(!selectContent.includes('value="local"'), 'local option absent in scope-select');
  });

  it('AC6f: projectScopeAvailable=true -> three options (user, project, local) in scope-select', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', true), { nonce, cspSource });
    const selectMatch = html.match(/id="scope-select"[\s\S]*?<\/select>/);
    assert.ok(selectMatch, 'scope-select element should be present');
    const selectContent = selectMatch![0];
    assert.ok(selectContent.includes('value="user"'), 'user option in scope-select');
    assert.ok(selectContent.includes('value="project"'), 'project option in scope-select');
    assert.ok(selectContent.includes('value="local"'), 'local option in scope-select');
  });
});

// ---------------------------------------------------------------------------
// AC7: scope select selected marking
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC7: scope selected marking', () => {
  const nonce = 'ac7scopenonce';
  const cspSource = 'vscode-webview://test-host';

  function makeVmWithScope(
    scope: 'user' | 'project' | 'local',
    projectScopeAvailable: boolean
  ): PluginManagerViewModel {
    return {
      marketplaces: [{ value: 'mk', label: 'mk' }],
      selected: 'mk',
      rows: [],
      page: 1,
      pageCount: 1,
      totalCount: 0,
      query: '',
      scope,
      projectScopeAvailable
    };
  }

  it('AC7a: scope="user" -> user option has selected attribute', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('user', false), { nonce, cspSource });
    const selectMatch = html.match(/id="scope-select"[\s\S]*?<\/select>/);
    assert.ok(selectMatch, 'scope-select must be present');
    // Look for user option with selected
    assert.ok(
      selectMatch![0].includes('value="user" selected') || selectMatch![0].includes("value='user' selected"),
      'user option should be marked selected when scope=user'
    );
  });

  it('AC7b: scope="project" -> project option has selected attribute', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('project', true), { nonce, cspSource });
    const selectMatch = html.match(/id="scope-select"[\s\S]*?<\/select>/);
    assert.ok(selectMatch, 'scope-select must be present');
    assert.ok(
      selectMatch![0].includes('value="project" selected') || selectMatch![0].includes("value='project' selected"),
      'project option should be marked selected when scope=project'
    );
    // user option should not be selected
    assert.ok(
      !selectMatch![0].includes('value="user" selected'),
      'user option should NOT be marked selected when scope=project'
    );
  });

  it('AC7c: scope="local" -> local option has selected attribute', () => {
    const html = renderPluginManagerHtml(makeVmWithScope('local', true), { nonce, cspSource });
    const selectMatch = html.match(/id="scope-select"[\s\S]*?<\/select>/);
    assert.ok(selectMatch, 'scope-select must be present');
    assert.ok(
      selectMatch![0].includes('value="local" selected') || selectMatch![0].includes("value='local' selected"),
      'local option should be marked selected when scope=local'
    );
  });
});

// ---------------------------------------------------------------------------
// AC8: scope included in posted messages + selectScope listener
// ---------------------------------------------------------------------------

describe('renderPluginManagerHtml -- AC8: scope in script messages', () => {
  const nonce = 'ac8scopenonce';
  const cspSource = 'vscode-webview://test-host';

  const vm: PluginManagerViewModel = {
    marketplaces: [{ value: 'mk', label: 'mk' }],
    selected: 'mk',
    rows: [
      { id: 'foo@mk', name: 'Foo', version: '1.0', installed: true, enabled: true, outdated: false }
    ],
    page: 1,
    pageCount: 1,
    totalCount: 1,
    query: '',
    scope: 'user',
    projectScopeAvailable: true
  };

  it('AC8a: inline script references scope-select element', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(html.includes('scope-select'), 'script must reference scope-select');
  });

  it('AC8b: script posts selectScope message on change of scope-select', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(
      html.includes("'selectScope'") || html.includes('"selectScope"'),
      'script must post type selectScope on scope change'
    );
  });

  it('AC8c: script includes scope in install/enable/disable/uninstall postMessage payloads', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    // The action handler should read the scope from scope-select and include it
    // We check that the word 'scope' appears in the postMessage call for actions
    // (the script must read scope-select.value and include it as 'scope' in the message)
    const scriptMatch = html.match(/<script nonce[\s\S]*?<\/script>/);
    assert.ok(scriptMatch, 'inline script must be present');
    const script = scriptMatch![0];
    // The action click handler must reference scope
    assert.ok(
      script.includes('scope'),
      'action click handler must include scope in postMessage'
    );
    // And scope-select must be read in the handler
    assert.ok(
      script.includes('scope-select'),
      'script must read scope from scope-select element'
    );
  });

  it('AC8d: action buttons still carry data-id and data-action attributes', () => {
    const html = renderPluginManagerHtml(vm, { nonce, cspSource });
    assert.ok(html.includes('data-id="foo@mk"'), 'button must carry data-id');
    assert.ok(html.includes('data-action="disable"') || html.includes('data-action="enable"'), 'button must carry data-action');
  });
});

// ---------------------------------------------------------------------------
// AC10: scope-specific enabled status via different enabled maps
// ---------------------------------------------------------------------------

describe('buildMarketplacePluginRows -- AC10: scope-specific enabled status', () => {
  // This test validates that passing different enabled maps (one per scope) yields
  // different row.enabled values for the same installed plugin.
  // The function itself is pure (src/core/marketplacePluginView.ts); the host picks the
  // correct map per scope and passes it in.
  it('AC10a: user-scope enabled map -> row.enabled reflects user scope', () => {
    const { buildMarketplacePluginRows } = require('../../src/core/marketplacePluginView');
    const installedMap = new Map([['foo', { name: 'foo', id: 'foo@mk', marketplace: 'mk', version: '1.0', installPath: '/p', lastUpdated: '' }]]);
    // User-scope: enabled
    const userEnabled = new Map([['foo@mk', true]]);
    const rows = buildMarketplacePluginRows('mk', installedMap, [], userEnabled, new Map());
    assert.strictEqual(rows[0].enabled, true);
  });

  it('AC10b: project-scope enabled map has different value -> row.enabled flips', () => {
    const { buildMarketplacePluginRows } = require('../../src/core/marketplacePluginView');
    const installedMap = new Map([['foo', { name: 'foo', id: 'foo@mk', marketplace: 'mk', version: '1.0', installPath: '/p', lastUpdated: '' }]]);
    // Project-scope: disabled
    const projectEnabled = new Map([['foo@mk', false]]);
    const rows = buildMarketplacePluginRows('mk', installedMap, [], projectEnabled, new Map());
    assert.strictEqual(rows[0].enabled, false);
  });

  it('AC10c: local-scope enabled map absent entry -> row.enabled is false', () => {
    const { buildMarketplacePluginRows } = require('../../src/core/marketplacePluginView');
    const installedMap = new Map([['foo', { name: 'foo', id: 'foo@mk', marketplace: 'mk', version: '1.0', installPath: '/p', lastUpdated: '' }]]);
    // Local-scope settings file has no entry for this plugin
    const localEnabled = new Map<string, boolean>(); // empty
    const rows = buildMarketplacePluginRows('mk', installedMap, [], localEnabled, new Map());
    // Absent from enabled map -> false (default for installed plugins)
    assert.strictEqual(rows[0].enabled, false);
  });
});
