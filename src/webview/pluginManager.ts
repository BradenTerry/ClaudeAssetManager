import * as vscode from 'vscode';
import { MarketplacePluginRow } from '../core/marketplacePluginView';
import { renderPluginManagerHtml, PluginManagerViewModel } from './pluginManagerHtml';
import { isValidPluginId, isValidMarketplaceName, normalizePluginScope, PluginInstallScope } from '../core/pluginValidation';

/** Data returned by the host for a given selected marketplace and page. */
export interface PluginManagerData {
  marketplaces: { value: string; label: string }[];
  selected: string;
  rows: MarketplacePluginRow[];
  page: number;
  pageCount: number;
  totalCount: number;
  query: string;
  /** Currently active installation scope. */
  scope: PluginInstallScope;
  /** Whether project-scoped options are available (a workspace folder is open). */
  projectScopeAvailable: boolean;
}

/** Host-side operations injected into the panel. */
export interface PluginManagerDeps {
  getData(selected: string, page: number, query: string, scope: PluginInstallScope): PluginManagerData;
  install(id: string, scope: PluginInstallScope): Promise<void>;
  uninstall(id: string, scope: PluginInstallScope): Promise<void>;
  enable(id: string, scope: PluginInstallScope): Promise<void>;
  disable(id: string, scope: PluginInstallScope): Promise<void>;
  addMarketplace(): Promise<void>;
  removeMarketplace(marketplace: string): Promise<void>;
}

/** Singleton panel reference. */
let panel: vscode.WebviewPanel | undefined;

/** Re-render callback captured from the active invocation's closure; cleared on dispose. */
let revealWith: ((preselect?: string) => void) | undefined;

/** Generate a 32-character nonce for CSP. */
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function toViewModel(data: PluginManagerData): PluginManagerViewModel {
  return {
    marketplaces: data.marketplaces,
    selected: data.selected,
    rows: data.rows,
    page: data.page,
    pageCount: data.pageCount,
    totalCount: data.totalCount,
    query: data.query,
    scope: data.scope,
    projectScopeAvailable: data.projectScopeAvailable
  };
}

/**
 * Open (or reveal) the Plugin Manager singleton webview panel.
 *
 * @param context        - extension context for disposable registration
 * @param deps           - host operations (read data, install, uninstall, etc.)
 * @param preselect      - optional marketplace value to preselect
 * @param scopePreselect - optional scope to preselect ('user' | 'project' | 'local')
 */
export function openPluginManager(
  context: vscode.ExtensionContext,
  deps: PluginManagerDeps,
  preselect?: string,
  scopePreselect?: PluginInstallScope
): void {
  if (panel) {
    // Panel already open -- delegate to the live closure to avoid TDZ on let declarations.
    if (preselect !== undefined) {
      revealWith?.(preselect);
    }
    panel.reveal(vscode.ViewColumn.Active);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'claudePluginManager',
    'Plugin Manager',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  let currentSelected = preselect ?? '';
  let currentPage = 1;
  let currentQuery = '';
  let currentScope: PluginInstallScope = scopePreselect ?? 'user';

  function renderPanel(selected: string, page: number, query: string): void {
    if (!panel) return;
    const data = deps.getData(selected, page, query, currentScope);
    currentSelected = data.selected;
    currentPage = data.page;
    currentQuery = data.query;
    panel.webview.html = renderPluginManagerHtml(
      toViewModel(data),
      { nonce: getNonce(), cspSource: panel.webview.cspSource }
    );
  }

  revealWith = (ps?: string) => renderPanel(ps ?? currentSelected, 1, '');

  panel.onDidDispose(() => {
    panel = undefined;
    revealWith = undefined;
  }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
    const type = msg['type'];

    if (type === 'selectScope') {
      const scope = normalizePluginScope(msg['scope']);
      if (!scope) return;
      currentScope = scope;
      renderPanel(currentSelected, currentPage, currentQuery);
      return;
    }

    if (type === 'install' || type === 'uninstall' || type === 'enable' || type === 'disable') {
      const id = msg['id'];
      if (typeof id !== 'string' || !isValidPluginId(id)) return;
      const msgScope = normalizePluginScope(msg['scope']) ?? currentScope;
      if (type === 'install') { await deps.install(id, msgScope); }
      else if (type === 'uninstall') { await deps.uninstall(id, msgScope); }
      else if (type === 'enable') { await deps.enable(id, msgScope); }
      else { await deps.disable(id, msgScope); }
      renderPanel(currentSelected, currentPage, currentQuery);
      return;
    }

    if (type === 'selectMarketplace') {
      const mk = msg['marketplace'];
      // "" is the local marketplace (valid); non-empty strings must pass isValidMarketplaceName.
      if (typeof mk !== 'string') return;
      if (mk !== '' && !isValidMarketplaceName(mk)) return;
      renderPanel(mk, 1, '');
      return;
    }

    if (type === 'search') {
      const q = msg['query'];
      if (typeof q !== 'string') return;
      renderPanel(currentSelected, 1, q.slice(0, 200));
      return;
    }

    if (type === 'page') {
      const p = msg['page'];
      if (typeof p !== 'number' || !Number.isFinite(p)) return;
      renderPanel(currentSelected, p, currentQuery);
      return;
    }

    if (type === 'addMarketplace') {
      await deps.addMarketplace();
      renderPanel(currentSelected, 1, '');
      return;
    }

    if (type === 'removeMarketplace') {
      const mk = msg['marketplace'];
      if (typeof mk !== 'string' || !isValidMarketplaceName(mk)) return;
      await deps.removeMarketplace(mk);
      renderPanel(currentSelected, 1, '');
      return;
    }

    if (type === 'refresh') {
      renderPanel(currentSelected, currentPage, currentQuery);
    }
  }, null, context.subscriptions);

  // Initial render.
  renderPanel(currentSelected, 1, '');
}
