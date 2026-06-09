import { MarketplacePluginRow } from '../core/marketplacePluginView';

/** Escape a string for safe insertion into HTML text or attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** View model for the Plugin Manager panel. */
export interface PluginManagerViewModel {
  /** All known marketplaces; value="" means local (displayed as "(local)"). */
  marketplaces: { value: string; label: string }[];
  /** Currently selected marketplace value. */
  selected: string;
  /** Rows for the current page. */
  rows: MarketplacePluginRow[];
  /** Current 1-based page number. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** Total rows after search filtering. */
  totalCount: number;
  /** Active search query (already trimmed/validated by host). */
  query: string;
  /** Currently selected installation scope. */
  scope: 'user' | 'project' | 'local';
  /** Whether project-scoped options should be shown (a workspace folder is open). */
  projectScopeAvailable: boolean;
}

/** Render a full HTML document for the Plugin Manager webview panel. */
export function renderPluginManagerHtml(
  vm: PluginManagerViewModel,
  opts: { nonce: string; cspSource: string }
): string {
  const { nonce, cspSource } = opts;

  const scopeOptionsHtml = [
    { value: 'user', label: 'Global (all projects)' },
    ...(vm.projectScopeAvailable ? [
      { value: 'project', label: 'This project - team' },
      { value: 'local', label: 'This project - just me' }
    ] : [])
  ].map(opt => {
    const sel = opt.value === vm.scope ? ' selected' : '';
    return `<option value="${escapeHtml(opt.value)}"${sel}>${escapeHtml(opt.label)}</option>`;
  }).join('\n          ');

  const optionsHtml = vm.marketplaces.map(mk => {
    const sel = mk.value === vm.selected ? ' selected' : '';
    return `<option value="${escapeHtml(mk.value)}"${sel}>${escapeHtml(mk.label)}</option>`;
  }).join('\n          ');

  const rowsHtml = vm.rows.map(row => {
    const statusText = row.installed
      ? (row.enabled ? 'Enabled' : 'Disabled')
      : 'Available';
    const outdatedBadge = row.outdated ? '<span class="badge-outdated">Update available</span>' : '';
    const descHtml = row.description ? `<div class="plugin-desc">${escapeHtml(row.description)}</div>` : '';

    let actionButtons = '';
    if (row.installed) {
      actionButtons += `<button data-id="${escapeHtml(row.id)}" data-action="uninstall">Uninstall</button> `;
      if (row.enabled) {
        actionButtons += `<button data-id="${escapeHtml(row.id)}" data-action="disable">Disable</button>`;
      } else {
        actionButtons += `<button data-id="${escapeHtml(row.id)}" data-action="enable">Enable</button>`;
      }
    } else {
      actionButtons += `<button data-id="${escapeHtml(row.id)}" data-action="install">Install</button>`;
    }

    return `
      <div class="plugin-row">
        <div class="plugin-header">
          <span class="plugin-name">${escapeHtml(row.name)}</span>
          <span class="plugin-version">${escapeHtml(row.version)}</span>
          <span class="plugin-status">${statusText}</span>
          ${outdatedBadge}
        </div>
        ${descHtml}
        <div class="plugin-actions">${actionButtons}</div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src ${cspSource} 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plugin Manager</title>
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px;
      margin: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 4px 6px;
    }
    input[type="search"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 4px 6px;
      flex: 1;
      min-width: 120px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 10px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .plugin-row {
      border-bottom: 1px solid var(--vscode-list-hoverBackground, #333);
      padding: 8px 4px;
    }
    .plugin-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .plugin-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .plugin-name { font-weight: bold; }
    .plugin-version { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .plugin-status { font-size: 0.85em; padding: 1px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; }
    .badge-outdated { font-size: 0.8em; color: var(--vscode-notificationsWarningIcon-foreground, orange); }
    .plugin-desc { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 4px; }
    .plugin-actions { display: flex; gap: 6px; }
    #no-results { color: var(--vscode-descriptionForeground); padding: 16px 0; }
    .pager {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 4px 4px;
    }
    .pager-info {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <select id="scope-select">
          ${scopeOptionsHtml}
    </select>
    <select id="marketplace-select">
          ${optionsHtml}
    </select>
    <button id="add-marketplace-btn">Add Marketplace</button>
    <button id="remove-marketplace-btn"${vm.selected === '' ? ' disabled' : ''}>Remove Marketplace</button>
    <input type="search" id="search-input" placeholder="Search plugins..." value="${escapeHtml(vm.query)}"${vm.query !== '' ? ' autofocus' : ''} />
  </div>
  <div id="plugin-list">
    ${rowsHtml || '<div id="no-results">No plugins found for this marketplace.</div>'}
  </div>
  <div class="pager">
    <button id="prev-page-btn"${vm.page <= 1 ? ' disabled' : ''}>Prev</button>
    <span class="pager-info">Page ${vm.page} of ${vm.pageCount} (${vm.totalCount})</span>
    <button id="next-page-btn"${vm.page >= vm.pageCount ? ' disabled' : ''}>Next</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Button click handler (install/uninstall/enable/disable).
    document.getElementById('plugin-list').addEventListener('click', function(e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const scope = document.getElementById('scope-select').value;
      if (id && action) {
        vscode.postMessage({ type: action, id: id, scope: scope });
      }
    });

    // Scope select.
    document.getElementById('scope-select').addEventListener('change', function() {
      vscode.postMessage({ type: 'selectScope', scope: this.value });
    });

    // Marketplace select.
    document.getElementById('marketplace-select').addEventListener('change', function() {
      vscode.postMessage({ type: 'selectMarketplace', marketplace: this.value });
    });

    // Add marketplace button.
    document.getElementById('add-marketplace-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'addMarketplace' });
    });

    // Remove marketplace button.
    document.getElementById('remove-marketplace-btn').addEventListener('click', function() {
      var value = document.getElementById('marketplace-select').value;
      if (value) {
        vscode.postMessage({ type: 'removeMarketplace', marketplace: value });
      }
    });

    // Host-side search: debounced input posts to host, which re-renders.
    (function() {
      var searchTimer = null;
      document.getElementById('search-input').addEventListener('input', function() {
        var val = this.value;
        if (searchTimer) { clearTimeout(searchTimer); }
        searchTimer = setTimeout(function() {
          vscode.postMessage({ type: 'search', query: val });
        }, 200);
      });
    })();

    // Pagination buttons.
    document.getElementById('prev-page-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'page', page: ${vm.page - 1} });
    });
    document.getElementById('next-page-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'page', page: ${vm.page + 1} });
    });

    // Restore search focus + caret position when a query is active.
    (function() {
      var searchEl = document.getElementById('search-input');
      if (searchEl && searchEl.value.length > 0) {
        searchEl.focus();
        var len = searchEl.value.length;
        searchEl.setSelectionRange(len, len);
      }
    })();
  </script>
</body>
</html>`;
}
