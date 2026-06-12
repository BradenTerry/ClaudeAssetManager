import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { scan } from './core/scanner';
import { buildScanRoots } from './core/scanRoots';
import { readInstalledPlugins, readCatalogVersions, readCatalogPlugins, isOutdated, readEnabledPlugins, readKnownMarketplaces, removeEnabledPluginEntry, InstalledPluginInfo } from './core/pluginMetadata';
import { isValidPluginId, isValidMarketplaceName, isSafeMarketplaceSource, buildScopedPluginArgs, parseEnabledScopeConflict, normalizePluginScope, computePluginScopePresence, PluginInstallScope } from './core/pluginValidation';
import { findProjectClaudeDir } from './core/findProjectClaudeDir';
import { buildMarketplacePluginRows, pageMarketplaceRows } from './core/marketplacePluginView';
import { openPluginManager, PluginManagerDeps } from './webview/pluginManager';
import { AssetTreeProvider } from './tree/assetTreeProvider';
import { AssetNode, PluginFolderNode, ContainerNode, GroupNode } from './tree/nodes';
import { AssetDragAndDropController } from './tree/dragController';
import { isValidAssetName, createAsset } from './core/assetCreation';
import { planDelete, deleteConfirmDetail } from './core/deletePlan';
import { deleteWithRetry } from './core/deleteWithRetry';
import { tokenLegendLines } from './core/tokenCount';
import { getSectionInfoByContextValue } from './core/sectionInfo';
import { AssetType } from './core/types';
import { watchRoots } from './services/watcher';
import {
  getDirectories,
  getFollowSymlinks,
  getExcludeDirs,
  getMaxDepth,
  getMarkdownOpenMode,
  getShowTokenUsage,
  setShowTokenUsage,
  getShowWorktrees,
  setShowWorktrees,
  addDirectory,
  removeDirectory
} from './services/settings';

/**
 * Resolve a filesystem path from a command argument. Tree single-click commands
 * pass the path as a string; context-menu invocations pass the tree node itself,
 * so we read the path off the node's resourceUri / filePath / dirPath.
 */
function resolveFsPath(arg: unknown): string | undefined {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    const node = arg as { resourceUri?: vscode.Uri; filePath?: string; dirPath?: string };
    if (node.resourceUri) {
      return node.resourceUri.fsPath;
    }
    if (typeof node.filePath === 'string') {
      return node.filePath;
    }
    if (typeof node.dirPath === 'string') {
      return node.dirPath;
    }
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const homeClaudeDir = path.join(os.homedir(), '.claude');
  const globalProvider = new AssetTreeProvider('global');
  const workingDirProvider = new AssetTreeProvider('working-directory');
  const addedDirsProvider = new AssetTreeProvider('added-directories');

  type Section = 'global' | 'working-directory' | 'added-directories';

  // Drives which token-toggle button (show/hide) each view's title bar renders.
  // Each section has its own independent toggle, key, and setting.
  const tokenCtxKey = (section: Section): string => {
    switch (section) {
      case 'global': return 'claudeAssets.tokenUsageEnabledGlobal';
      case 'working-directory': return 'claudeAssets.tokenUsageEnabledWorkingDirectory';
      case 'added-directories': return 'claudeAssets.tokenUsageEnabledAddedDirectories';
    }
  };
  vscode.commands.executeCommand('setContext', tokenCtxKey('global'), getShowTokenUsage('global'));
  vscode.commands.executeCommand('setContext', tokenCtxKey('working-directory'), getShowTokenUsage('working-directory'));
  vscode.commands.executeCommand('setContext', tokenCtxKey('added-directories'), getShowTokenUsage('added-directories'));

  // Drives which worktree-toggle button (show/hide) the Working Directory title bar renders.
  const WORKTREES_CTX_KEY = 'claudeAssets.worktreesEnabled';
  vscode.commands.executeCommand('setContext', WORKTREES_CTX_KEY, getShowWorktrees());

  let disposeWatcher: (() => void) | null = null;
  // Root paths from the latest scan; a save under one of these triggers a re-scan
  // (so token counts update on save even where recursive fs.watch is unsupported).
  let scanRootPaths: string[] = [];
  let saveRescanTimer: ReturnType<typeof setTimeout> | null = null;
  // Latest set of outdated plugins, refreshed on every scan; drives "Update all".
  let outdatedPlugins: InstalledPluginInfo[] = [];
  // The workspace folder that owns a .claude directory, updated on every scan.
  let currentProjectDir: string | undefined;
  // Raw per-file enablement maps for the owning project folder, updated on every scan.
  let currentTeamEnabled: Map<string, boolean> = new Map();
  let currentLocalEnabled: Map<string, boolean> = new Map();

  /**
   * Run `claude plugin update <id>` for each id sequentially behind a progress
   * notification. Returns the ids that failed along with their error output.
   */
  async function runPluginUpdates(ids: string[]): Promise<{ failed: { id: string; output: string }[] }> {
    const failed: { id: string; output: string }[] = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating plugins',
        cancellable: false
      },
      async progress => {
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          progress.report({ message: `${id} (${i + 1}/${ids.length})`, increment: 100 / ids.length });
          if (!isValidPluginId(id)) {
            failed.push({ id, output: 'invalid plugin id -- skipped for safety' });
            continue;
          }
          const result = await new Promise<{ ok: boolean; output: string }>(resolve => {
            // On Windows the CLI is a `claude.cmd` shim; execFile only resolves it via a shell.
            execFile('claude', ['plugin', 'update', id], { timeout: 120000, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
              resolve({ ok: !err, output: `${stdout ?? ''}${stderr ?? ''}`.trim() });
            });
          });
          if (!result.ok) {
            failed.push({ id, output: result.output || 'unknown error' });
          }
        }
      }
    );
    return { failed };
  }

  /** Confirm, run updates, report results, then re-scan. */
  async function performUpdates(ids: string[], confirmDetail: string): Promise<void> {
    if (ids.length === 0) {
      vscode.window.showInformationMessage('No plugin updates available.');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Update ${ids.length} plugin${ids.length === 1 ? '' : 's'}?`,
      { modal: true, detail: confirmDetail },
      'Update'
    );
    if (confirm !== 'Update') {
      return;
    }
    const { failed } = await runPluginUpdates(ids);
    await runScan();
    if (failed.length === 0) {
      vscode.window.showInformationMessage(
        `Updated ${ids.length} plugin${ids.length === 1 ? '' : 's'}. Restart your Claude Code session to apply.`
      );
    } else {
      const names = failed.map(f => f.id).join(', ');
      vscode.window.showErrorMessage(`Failed to update ${names}. ${failed[0].output}`);
    }
  }

  /** Run a claude CLI command behind a progress notification. Resolves with ok+output. */
  function runClaude(args: string[], title: string, cwd?: string): Promise<{ ok: boolean; output: string }> {
    return Promise.resolve(
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        () => new Promise<{ ok: boolean; output: string }>(resolve => {
          execFile('claude', args, { timeout: 120000, shell: process.platform === 'win32', cwd }, (err, so, se) =>
            resolve({ ok: !err, output: `${so ?? ''}${se ?? ''}`.trim() }));
        })
      )
    );
  }

  /**
   * Shared uninstall flow used by both the tree command and the GUI dep.
   * nodeScope: the scope of the plugin entry being uninstalled (project/local for WD nodes,
   * undefined for user-scope / global-node uninstalls).
   *
   * When the plugin is present at more than one scope (installed + has enabledPlugins entries
   * elsewhere), shows a QuickPick so the user can choose exactly what to remove.
   */
  async function handleUninstall(id: string, name: string, nodeScope?: PluginInstallScope): Promise<void> {
    if (!isValidPluginId(id)) {
      vscode.window.showErrorMessage(`Invalid plugin id "${id}".`);
      return;
    }

    const isProjectOrLocal = nodeScope === 'project' || nodeScope === 'local';
    if (isProjectOrLocal && !currentProjectDir) {
      vscode.window.showErrorMessage(
        `No workspace folder with a .claude directory found. Cannot run a ${nodeScope}-scoped uninstall.`
      );
      return;
    }

    // Determine all scopes where the plugin is present.
    const userEnabled = readEnabledPlugins(path.join(homeClaudeDir, 'settings.json'));
    const presence = computePluginScopePresence(
      id,
      nodeScope ?? 'user',
      userEnabled,
      currentTeamEnabled,
      currentLocalEnabled
    );

    if (presence.length > 1) {
      // Multi-scope: show picker
      const scopeLabel = (s: PluginInstallScope): string => {
        if (s === 'user') return 'Global (all projects)';
        if (s === 'project') return 'Project (team)';
        return 'Just me (local)';
      };

      type ScopeItem = vscode.QuickPickItem & { scopeEntry?: typeof presence[number]; allScopes?: true };

      const items: ScopeItem[] = presence.map(entry => ({
        label: scopeLabel(entry.scope),
        description: entry.installed ? 'installed' : 'enabled here',
        scopeEntry: entry
      }));
      items.push({ label: 'All scopes', description: 'Remove from every scope', allScopes: true });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `"${name}" is present at multiple scopes. Choose what to remove.`,
        ignoreFocusOut: true
      });

      if (!picked) return;

      const toProcess = picked.allScopes ? presence : (picked.scopeEntry ? [picked.scopeEntry] : []);
      if (toProcess.length === 0) return;

      const settingsPathForScope = (scope: PluginInstallScope): string =>
        scope === 'user'    ? path.join(homeClaudeDir, 'settings.json')
        : scope === 'project' ? path.join(currentProjectDir!, '.claude', 'settings.json')
        :                       path.join(currentProjectDir!, '.claude', 'settings.local.json');

      const errors: string[] = [];
      for (const entry of toProcess) {
        if (!currentProjectDir && entry.scope !== 'user') { continue; }
        const cwd = entry.scope === 'user' ? undefined : currentProjectDir;
        let result: { ok: boolean; output: string };
        if (entry.installed) {
          result = await runClaude(
            buildScopedPluginArgs('uninstall', id, entry.scope),
            `Uninstalling ${name} (${entry.scope})`,
            cwd
          );
          if (result.ok) { removeEnabledPluginEntry(settingsPathForScope(entry.scope), id); }
        } else {
          removeEnabledPluginEntry(settingsPathForScope(entry.scope), id);
          result = { ok: true, output: '' };
        }
        if (!result.ok) {
          errors.push(`${entry.scope}: ${result.output || 'unknown error'}`);
        }
      }

      await runScan();

      if (errors.length === 0) {
        vscode.window.showInformationMessage(`Uninstalled ${name}. Restart your Claude Code session to apply.`);
      } else {
        vscode.window.showErrorMessage(`Failed to uninstall ${name}. ${errors.join('; ')}`);
      }
      return;
    }

    // Single-scope: existing confirm+uninstall flow.
    const scopeFlag = nodeScope ? ` --scope ${nodeScope}` : '';
    const confirm = await vscode.window.showWarningMessage(
      `Uninstall plugin "${name}"?`,
      { modal: true, detail: `This runs: claude plugin uninstall ${id}${scopeFlag}` },
      'Uninstall'
    );
    if (confirm !== 'Uninstall') return;

    const initialArgs = nodeScope
      ? buildScopedPluginArgs('uninstall', id, nodeScope)
      : ['plugin', 'uninstall', id];
    const initialCwd = isProjectOrLocal ? currentProjectDir : undefined;

    const result = await runClaude(initialArgs, `Uninstalling ${name}`, initialCwd);
    await runScan();

    if (result.ok) {
      vscode.window.showInformationMessage(`Uninstalled ${name}. Restart your Claude Code session to apply.`);
      return;
    }

    const conflict = parseEnabledScopeConflict(result.output);
    if (!conflict) {
      vscode.window.showErrorMessage(`Failed to uninstall ${name}. ${result.output || 'unknown error'}`);
      return;
    }

    const conflictIsProjectOrLocal = conflict === 'project' || conflict === 'local';
    if (conflictIsProjectOrLocal && !currentProjectDir) {
      vscode.window.showErrorMessage(
        `Failed to uninstall ${name}. The plugin is enabled at ${conflict} scope. ` +
        `Run manually: claude plugin uninstall ${id} --scope ${conflict}`
      );
      return;
    }

    // Build the conflict dialog.
    type RemediationButton = 'Remove for team & uninstall' | 'Disable for just me' | 'Uninstall (local)' | 'Uninstall (user)';
    let detail: string;
    let buttons: RemediationButton[];

    if (conflict === 'project') {
      detail =
        `The plugin is enabled at project scope (.claude/settings.json, shared with your team).\n\n` +
        `"Remove for team & uninstall" runs: claude plugin uninstall ${id} --scope project\n` +
        `"Disable for just me" runs: claude plugin disable ${id} --scope local\n\n` +
        `Note: "Remove for team & uninstall" modifies the team-shared settings.json.`;
      buttons = ['Remove for team & uninstall', 'Disable for just me'];
    } else if (conflict === 'local') {
      detail = `The plugin is enabled at local scope.\nThis runs: claude plugin uninstall ${id} --scope local`;
      buttons = ['Uninstall (local)'];
    } else {
      detail = `The plugin is enabled at user scope.\nThis runs: claude plugin uninstall ${id} --scope user`;
      buttons = ['Uninstall (user)'];
    }

    const chosen = await vscode.window.showWarningMessage(
      `Cannot uninstall "${name}": enabled at ${conflict} scope`,
      { modal: true, detail },
      ...buttons
    );

    if (!chosen) return;

    if (chosen === 'Disable for just me') {
      const disableArgs = buildScopedPluginArgs('disable', id, 'local');
      const disableResult = await runClaude(disableArgs, `Disabling ${name} (local)`, currentProjectDir);
      await runScan();
      if (disableResult.ok) {
        vscode.window.showInformationMessage(
          `Disabled ${name} for you (local). It is still installed and enabled for your team.`
        );
      } else {
        vscode.window.showErrorMessage(`Failed to disable ${name}. ${disableResult.output || 'unknown error'}`);
      }
      return;
    }

    // Remediation uninstall path.
    const remediationCwd = conflict === 'user' ? undefined : currentProjectDir;
    const remediationArgs = buildScopedPluginArgs('uninstall', id, conflict);
    const remediationResult = await runClaude(remediationArgs, `Uninstalling ${name}`, remediationCwd);
    await runScan();
    if (remediationResult.ok) {
      vscode.window.showInformationMessage(`Uninstalled ${name}. Restart your Claude Code session to apply.`);
    } else {
      vscode.window.showErrorMessage(`Failed to uninstall ${name}. ${remediationResult.output || 'unknown error'}`);
    }
  }

  async function runScan(): Promise<void> {
    const registeredDirs = getDirectories();
    const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const excludeDirs = getExcludeDirs();
    const followSymlinks = getFollowSymlinks();
    const maxDepth = getMaxDepth();

    const roots = buildScanRoots(homeClaudeDir, registeredDirs, workspaceDirs);
    scanRootPaths = roots.map(r => r.path);
    const assets = scan(roots, { excludeDirs, followSymlinks, maxDepth });

    // Read installed plugins and catalog cache (no network; files maintained by Claude)
    const installedPluginsJsonPath = path.join(homeClaudeDir, 'plugins', 'installed_plugins.json');
    const catalogCacheJsonPath = path.join(homeClaudeDir, 'plugins', 'plugin-catalog-cache.json');
    const installedPlugins = readInstalledPlugins(installedPluginsJsonPath);
    const catalogMap = readCatalogVersions(catalogCacheJsonPath);
    const outdated = new Set<string>();
    outdatedPlugins = [];
    for (const [name, info] of installedPlugins) {
      if (isOutdated(info, catalogMap.get(name))) {
        outdated.add(name);
        outdatedPlugins.push(info);
      }
    }

    const enabledMap = readEnabledPlugins(path.join(homeClaudeDir, 'settings.json'));
    const marketplaces = readKnownMarketplaces(path.join(homeClaudeDir, 'plugins', 'known_marketplaces.json'));

    // Read project-scoped enablement from the owning project folder (raw per-file maps).
    const owningFolder = findProjectClaudeDir(workspaceDirs);
    const projectClaudeDir = owningFolder?.projectClaudeDir;
    currentProjectDir = owningFolder?.projectDir;
    currentTeamEnabled = currentProjectDir
      ? readEnabledPlugins(path.join(currentProjectDir, '.claude', 'settings.json'))
      : new Map();
    currentLocalEnabled = currentProjectDir
      ? readEnabledPlugins(path.join(currentProjectDir, '.claude', 'settings.local.json'))
      : new Map();

    // Show the Working Directory type folders for any open workspace, even one without a .claude
    // dir yet, so there is always somewhere to create or drop assets.
    const ensureWorkingDirBase = projectClaudeDir
      ?? (workspaceDirs.length > 0 ? path.join(workspaceDirs[0], '.claude') : undefined);

    const meta = { installedPlugins, outdated, enabled: enabledMap, marketplaces, projectTeamEnabled: currentTeamEnabled, projectLocalEnabled: currentLocalEnabled, projectClaudeDir, globalClaudeDir: homeClaudeDir, registeredDirs, ensureWorkingDirBase };
    // Each provider leads its tree with a token-summary row (info icon + (a)/(d)
    // legend) when its section's token toggle is on -- see AssetTreeProvider.rebuild.
    globalProvider.update(assets, meta);
    workingDirProvider.update(assets, meta);
    addedDirsProvider.update(assets, meta);

    // Re-watch
    if (disposeWatcher) {
      disposeWatcher();
    }
    disposeWatcher = watchRoots(roots, () => {
      runScan().catch(() => { /* ignore */ });
    });
  }

  // Register the two sidebar sections as separate views
  // One controller shared by all three views so assets can be drag-copied between them.
  const dndController = new AssetDragAndDropController(() => runScan());
  const globalView = vscode.window.createTreeView('claudeAssets.global', {
    treeDataProvider: globalProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dndController
  });
  const workingDirView = vscode.window.createTreeView('claudeAssets.workingDirectory', {
    treeDataProvider: workingDirProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dndController
  });
  const addedDirsView = vscode.window.createTreeView('claudeAssets.addedDirectories', {
    treeDataProvider: addedDirsProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dndController
  });

  // Title the Working Directory section after the folder VSCode is open in, e.g. "Projects (WD)".
  function updateWorkingDirTitle(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length === 1) {
      workingDirView.title = `${folders[0].name} (WD)`;
    } else if (folders && folders.length > 1) {
      workingDirView.title = `${vscode.workspace.name ?? 'Workspace'} (WD)`;
    } else {
      workingDirView.title = 'Working Directory';
    }
  }
  updateWorkingDirTitle();

  const PLUGIN_PAGE_SIZE = 50;

  // Plugin Manager deps -- closed over activate() locals.
  const pluginManagerDeps: PluginManagerDeps = {
    getData(selected: string, page: number, query: string, scope: PluginInstallScope) {
      const installedPath = path.join(homeClaudeDir, 'plugins', 'installed_plugins.json');
      const catalogPath = path.join(homeClaudeDir, 'plugins', 'plugin-catalog-cache.json');
      const mkPath = path.join(homeClaudeDir, 'plugins', 'known_marketplaces.json');
      const catalogVersionsMap = readCatalogVersions(catalogPath);

      const installedMap = readInstalledPlugins(installedPath);
      const catalogArr = readCatalogPlugins(catalogPath);
      const knownMk = readKnownMarketplaces(mkPath);

      // Pick the enabled map per scope, using the owning folder (not always folder[0]).
      let enabledMap: Map<string, boolean>;
      if (scope === 'project' && currentProjectDir) {
        enabledMap = readEnabledPlugins(path.join(currentProjectDir, '.claude', 'settings.json'));
      } else if (scope === 'local' && currentProjectDir) {
        enabledMap = readEnabledPlugins(path.join(currentProjectDir, '.claude', 'settings.local.json'));
      } else {
        enabledMap = readEnabledPlugins(path.join(homeClaudeDir, 'settings.json'));
      }

      const projectScopeAvailable = !!currentProjectDir;

      // Build marketplace option list: sorted known marketplaces + local if any installed plugin has mk="".
      const mkNames = [...knownMk.keys()].sort((a, b) => a.localeCompare(b));
      const marketplaces: { value: string; label: string }[] = mkNames.map(n => ({ value: n, label: n }));
      const hasLocal = [...installedMap.values()].some(i => i.marketplace === '');
      if (hasLocal) {
        marketplaces.unshift({ value: '', label: '(local)' });
      }

      // Determine effective selected.
      const validValues = new Set(marketplaces.map(m => m.value));
      let effectiveSelected: string;
      if (validValues.has(selected)) {
        effectiveSelected = selected;
      } else if (marketplaces.length > 0) {
        effectiveSelected = marketplaces[0].value;
      } else {
        effectiveSelected = '';
      }

      const allRows = buildMarketplacePluginRows(effectiveSelected, installedMap, catalogArr, enabledMap, catalogVersionsMap);
      const paged = pageMarketplaceRows(allRows, { page, pageSize: PLUGIN_PAGE_SIZE, query });
      return {
        marketplaces,
        selected: effectiveSelected,
        rows: paged.rows,
        page: paged.page,
        pageCount: paged.pageCount,
        totalCount: paged.totalCount,
        query,
        scope,
        projectScopeAvailable
      };
    },

    async install(id: string, scope: PluginInstallScope) {
      if (scope !== 'user' && !currentProjectDir) {
        vscode.window.showErrorMessage('No workspace folder with a .claude directory found. Cannot run a project/local-scoped install.');
        return;
      }
      const installCwd = scope !== 'user' ? currentProjectDir : undefined;
      const args = buildScopedPluginArgs('install', id, scope);
      const result = await runClaude(args, `Installing ${id}`, installCwd);
      await runScan();
      if (!result.ok) {
        vscode.window.showErrorMessage(`Failed to install ${id}. ${result.output || 'unknown error'}`);
      }
    },

    async uninstall(id: string, scope: PluginInstallScope) {
      const validScope = normalizePluginScope(scope) ?? 'user';
      const name = id.includes('@') ? id.slice(0, id.indexOf('@')) : id;
      await handleUninstall(id, name, validScope === 'user' ? undefined : validScope);
    },

    async enable(id: string, scope: PluginInstallScope) {
      if (scope !== 'user' && !currentProjectDir) {
        vscode.window.showErrorMessage('No workspace folder with a .claude directory found. Cannot run a project/local-scoped enable.');
        return;
      }
      const enableCwd = scope !== 'user' ? currentProjectDir : undefined;
      const args = buildScopedPluginArgs('enable', id, scope);
      const result = await runClaude(args, `Enabling ${id}`, enableCwd);
      await runScan();
      if (!result.ok) {
        vscode.window.showErrorMessage(`Failed to enable ${id}. ${result.output || 'unknown error'}`);
      }
    },

    async disable(id: string, scope: PluginInstallScope) {
      if (scope !== 'user' && !currentProjectDir) {
        vscode.window.showErrorMessage('No workspace folder with a .claude directory found. Cannot run a project/local-scoped disable.');
        return;
      }
      const disableCwd = scope !== 'user' ? currentProjectDir : undefined;
      const args = buildScopedPluginArgs('disable', id, scope);
      const result = await runClaude(args, `Disabling ${id}`, disableCwd);
      await runScan();
      if (!result.ok) {
        vscode.window.showErrorMessage(`Failed to disable ${id}. ${result.output || 'unknown error'}`);
      }
    },

    async addMarketplace() {
      await vscode.commands.executeCommand('claudeAssets.addMarketplace');
    },

    async removeMarketplace(marketplace: string) {
      await vscode.commands.executeCommand('claudeAssets.removeMarketplace', { label: marketplace });
    }
  };

  // Toggle one section's token display: persist, flip its context key (button state), re-scan.
  async function setSectionTokens(section: Section, value: boolean): Promise<void> {
    await setShowTokenUsage(section, value);
    await vscode.commands.executeCommand('setContext', tokenCtxKey(section), value);
    await runScan();
  }

  // Toggle Working Directory worktree visibility: persist, flip its context key, re-scan.
  async function setWorktreesVisible(value: boolean): Promise<void> {
    await setShowWorktrees(value);
    await vscode.commands.executeCommand('setContext', WORKTREES_CTX_KEY, value);
    await runScan();
  }

  // Shared helper: prompts for a name, creates the asset file, re-scans, then opens it.
  async function handleCreate(type: AssetType, node: GroupNode | undefined, label: string): Promise<void> {
    const targetDir = node?.createTargetDir;
    if (!targetDir) {
      vscode.window.showErrorMessage(`Could not determine target directory for new ${label}.`);
      return;
    }
    // Refuse to create inside the Claude-managed plugins tree (mirrors the delete guard).
    const pluginsRoot = path.join(homeClaudeDir, 'plugins');
    if (targetDir === pluginsRoot || targetDir.startsWith(pluginsRoot + path.sep)) {
      vscode.window.showInformationMessage(
        'Plugin files are managed by Claude. Use the Plugin Manager to install plugins instead.'
      );
      return;
    }
    const name = await vscode.window.showInputBox({
      title: `New ${label}`,
      prompt: `Enter a name for the new ${label.toLowerCase()} (letters, digits, dash, underscore).`,
      ignoreFocusOut: true,
      validateInput: v => (isValidAssetName(v ?? '') ? undefined : 'Use letters, digits, dash, underscore; no slashes or leading dot.')
    });
    if (!name) return;
    let filePath: string;
    try {
      filePath = createAsset(type, targetDir, name);
    } catch (err) {
      vscode.window.showErrorMessage(`Could not create ${label}: ${err}`);
      return;
    }
    await runScan();
    vscode.commands.executeCommand('claudeAssets.openMarkdown', filePath).then(undefined, (err: unknown) => {
      vscode.window.showErrorMessage(`Could not open ${label} file: ${err}`);
    });
  }

  // Commands
  context.subscriptions.push(
    globalView,
    workingDirView,
    addedDirsView,
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateWorkingDirTitle()),

    vscode.commands.registerCommand('claudeAssets.refresh', () => {
      runScan().catch(err => {
        vscode.window.showErrorMessage(`Scan failed: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.enableTokenUsageGlobal', () => setSectionTokens('global', true)),
    vscode.commands.registerCommand('claudeAssets.disableTokenUsageGlobal', () => setSectionTokens('global', false)),
    vscode.commands.registerCommand('claudeAssets.enableTokenUsageWorkingDirectory', () => setSectionTokens('working-directory', true)),
    vscode.commands.registerCommand('claudeAssets.disableTokenUsageWorkingDirectory', () => setSectionTokens('working-directory', false)),
    vscode.commands.registerCommand('claudeAssets.enableTokenUsageAddedDirectories', () => setSectionTokens('added-directories', true)),
    vscode.commands.registerCommand('claudeAssets.disableTokenUsageAddedDirectories', () => setSectionTokens('added-directories', false)),
    vscode.commands.registerCommand('claudeAssets.showWorktrees', () => setWorktreesVisible(true)),
    vscode.commands.registerCommand('claudeAssets.hideWorktrees', () => setWorktreesVisible(false)),
    vscode.commands.registerCommand('claudeAssets.tokenLegend', () => {
      vscode.window.showInformationMessage(
        'Token estimates -- what the abbreviations mean',
        { modal: true, detail: tokenLegendLines().join('\n') }
      );
    }),

    vscode.commands.registerCommand('claudeAssets.openDefault', (arg: unknown) => {
      const filePath = resolveFsPath(arg);
      if (!filePath) {
        vscode.window.showErrorMessage('Could not open: no file path.');
        return;
      }
      // vscode.open honors the user's configured default editor for the file type.
      const uri = vscode.Uri.file(filePath);
      vscode.commands.executeCommand('vscode.open', uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not open file: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.openFile', (arg: unknown) => {
      const filePath = resolveFsPath(arg);
      if (!filePath) {
        vscode.window.showErrorMessage('Could not open file: no file path.');
        return;
      }
      const uri = vscode.Uri.file(filePath);
      vscode.window.showTextDocument(uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not open file: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.openPreview', (arg: unknown) => {
      const filePath = resolveFsPath(arg);
      if (!filePath) {
        vscode.window.showErrorMessage('Could not open preview: no file path.');
        return;
      }
      const uri = vscode.Uri.file(filePath);
      vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not open preview: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.openMarkdown', (arg: unknown) => {
      const filePath = resolveFsPath(arg);
      if (!filePath) { vscode.window.showErrorMessage('Could not open: no file path.'); return; }
      const uri = vscode.Uri.file(filePath);
      const mode = getMarkdownOpenMode();
      const fail = (err: unknown) => vscode.window.showErrorMessage(`Could not open file: ${err}`);
      if (mode === 'preview') {
        vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, fail);
      } else if (mode === 'code') {
        // preview:true reuses the single ephemeral tab instead of accumulating tabs.
        vscode.window.showTextDocument(uri, { preview: true }).then(undefined, fail);
      } else if (mode === 'split') {
        // Pin the source to the first column so the side preview always lands in the
        // same second column (reused, not locked) -- otherwise the active column drifts
        // right on each open and VS Code keeps spawning new splits.
        vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: true }).then(
          () => vscode.commands.executeCommand('markdown.showPreviewToSide', uri).then(undefined, fail),
          fail
        );
      } else { // default
        vscode.commands.executeCommand('vscode.open', uri).then(undefined, fail);
      }
    }),

    vscode.commands.registerCommand('claudeAssets.revealInOS', (arg: unknown) => {
      const targetPath = resolveFsPath(arg);
      if (!targetPath) {
        vscode.window.showErrorMessage('Could not reveal: no path.');
        return;
      }
      const uri = vscode.Uri.file(targetPath);
      vscode.commands.executeCommand('revealFileInOS', uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not reveal: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.updatePlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId;
      if (!id) {
        vscode.window.showErrorMessage('Could not determine which plugin to update.');
        return;
      }
      await performUpdates([id], `This runs: claude plugin update ${id}`);
    }),

    vscode.commands.registerCommand('claudeAssets.updateAllPlugins', async () => {
      const ids = outdatedPlugins.map(p => p.id);
      await performUpdates(ids, ids.length > 0 ? `Plugins to update:\n${ids.join('\n')}` : '');
    }),

    vscode.commands.registerCommand('claudeAssets.updateMarketplacePlugins', async (node?: ContainerNode) => {
      const mk = typeof node?.label === 'string' ? node.label : undefined;
      if (!mk) {
        vscode.window.showErrorMessage('Could not determine which marketplace to update.');
        return;
      }
      const ids = outdatedPlugins.filter(p => (p.marketplace || '(local)') === mk).map(p => p.id);
      await performUpdates(ids, ids.length > 0 ? `Plugins to update in ${mk}:\n${ids.join('\n')}` : '');
    }),

    vscode.commands.registerCommand('claudeAssets.uninstallPlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId ?? node?.pluginName;
      if (!id) {
        vscode.window.showErrorMessage('Could not determine which plugin to uninstall.');
        return;
      }
      const name = node?.pluginName ?? id;
      await handleUninstall(id, name, node?.scope);
    }),

    vscode.commands.registerCommand('claudeAssets.deleteFile', async (arg: unknown) => {
      const pluginsRoot = path.join(homeClaudeDir, 'plugins');
      const plan = planDelete(resolveFsPath(arg), pluginsRoot);
      if (!plan.ok) {
        if (plan.refusal === 'no-path') {
          vscode.window.showErrorMessage('Could not delete: no path.');
        } else if (plan.refusal === 'plugins-managed') {
          vscode.window.showInformationMessage(
            'Plugin files are managed by Claude. Right-click the plugin and choose "Uninstall Plugin" instead.'
          );
        } else if (plan.refusal === 'not-found') {
          vscode.window.showErrorMessage(`Could not delete: ${plan.targetPath} no longer exists.`);
          runScan().catch(() => { /* ignore */ });
        }
        return;
      }
      const { targetPath, name, kind } = plan;
      const confirm = await vscode.window.showWarningMessage(
        `Delete ${kind} "${name}"?`,
        { modal: true, detail: deleteConfirmDetail(targetPath!) },
        'Delete'
      );
      if (confirm !== 'Delete') {
        return;
      }
      // Release the recursive fs.watch handle before deleting. On Windows that
      // handle locks the .claude tree and the delete fails with EBUSY/EPERM;
      // runScan() below re-establishes the watch afterwards.
      if (disposeWatcher) {
        disposeWatcher();
        disposeWatcher = null;
      }
      try {
        await deleteWithRetry(() =>
          Promise.resolve(
            vscode.workspace.fs.delete(vscode.Uri.file(targetPath!), { recursive: true, useTrash: true })
          )
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Could not delete ${name}: ${err}`);
        await runScan();
        return;
      }
      await runScan();
    }),

    vscode.commands.registerCommand('claudeAssets.addDirectory', async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Add Directory to Claude Assets Scan'
      });
      if (result && result.length > 0) {
        await addDirectory(result[0].fsPath);
        runScan().catch(() => { /* ignore */ });
      }
    }),

    vscode.commands.registerCommand('claudeAssets.removeDirectory', async (arg?: unknown) => {
      const dirs = getDirectories();
      if (dirs.length === 0) {
        vscode.window.showInformationMessage('No registered directories to remove.');
        return;
      }
      // Right-click on a registered-dir folder passes the node -> remove that one directly.
      // Invoked from the palette (no node) -> ask which one.
      const fromNode = resolveFsPath(arg);
      const picked = fromNode && dirs.includes(fromNode)
        ? fromNode
        : await vscode.window.showQuickPick(dirs, { placeHolder: 'Select a directory to remove' });
      if (picked) {
        await removeDirectory(picked);
        runScan().catch(() => { /* ignore */ });
        vscode.window.showInformationMessage(`Removed "${path.basename(picked)}" from scanned directories.`);
      }
    }),

    vscode.commands.registerCommand('claudeAssets.enablePlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId;
      if (!id || !isValidPluginId(id)) {
        vscode.window.showErrorMessage('Could not determine a valid plugin id to enable.');
        return;
      }
      const args: string[] = ['plugin', 'enable', id];
      if (node?.scope) { args.push('--scope', node.scope); }
      const scopeNote = node?.scope ? ` (${node.scope} scope)` : '';
      const isProjectScoped = node?.scope === 'project' || node?.scope === 'local';
      if (isProjectScoped && !currentProjectDir) {
        vscode.window.showErrorMessage('No workspace folder with a .claude directory found. Cannot run a project/local-scoped enable.');
        return;
      }
      const enableCwd = isProjectScoped ? currentProjectDir : undefined;
      const result = await runClaude(args, `Enabling ${id}`, enableCwd);
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(
          `Enabled ${id}${scopeNote}. Restart your Claude Code session to apply.`
        );
      } else {
        vscode.window.showErrorMessage(
          `Failed to enable ${id}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.disablePlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId;
      if (!id || !isValidPluginId(id)) {
        vscode.window.showErrorMessage('Could not determine a valid plugin id to disable.');
        return;
      }
      const args: string[] = ['plugin', 'disable', id];
      if (node?.scope) { args.push('--scope', node.scope); }
      const scopeNote = node?.scope ? ` (${node.scope} scope)` : '';
      const isProjectScoped = node?.scope === 'project' || node?.scope === 'local';
      if (isProjectScoped && !currentProjectDir) {
        vscode.window.showErrorMessage('No workspace folder with a .claude directory found. Cannot run a project/local-scoped disable.');
        return;
      }
      const disableCwd = isProjectScoped ? currentProjectDir : undefined;
      const result = await runClaude(args, `Disabling ${id}`, disableCwd);
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(
          `Disabled ${id}${scopeNote}. Restart your Claude Code session to apply.`
        );
      } else {
        vscode.window.showErrorMessage(
          `Failed to disable ${id}. ${result.output || 'unknown error'}`
        );
      }
    }),

    ...((): vscode.Disposable[] => {
      async function scopedToggle(
        node: PluginFolderNode | undefined,
        op: 'enable' | 'disable',
        scope: 'project' | 'local',
        label: string
      ): Promise<void> {
        const id = node?.pluginId;
        if (!id || !isValidPluginId(id)) {
          vscode.window.showErrorMessage(`Could not determine a valid plugin id to ${op}.`);
          return;
        }
        if (!currentProjectDir) {
          vscode.window.showErrorMessage('No workspace folder with a .claude directory found.');
          return;
        }
        const verb = op === 'enable' ? 'Enabling' : 'Disabling';
        const done = op === 'enable' ? 'Enabled' : 'Disabled';
        const result = await runClaude(buildScopedPluginArgs(op, id, scope), `${verb} ${id} (${label})`, currentProjectDir);
        await runScan();
        if (result.ok) {
          vscode.window.showInformationMessage(`${done} ${id} (${label}). Restart your Claude Code session to apply.`);
        } else {
          vscode.window.showErrorMessage(`Failed to ${op} ${id} (${label}). ${result.output || 'unknown error'}`);
        }
      }
      return [
        vscode.commands.registerCommand('claudeAssets.enablePluginTeam', (node?: PluginFolderNode) => scopedToggle(node, 'enable', 'project', 'team')),
        vscode.commands.registerCommand('claudeAssets.disablePluginTeam', (node?: PluginFolderNode) => scopedToggle(node, 'disable', 'project', 'team')),
        vscode.commands.registerCommand('claudeAssets.enablePluginPersonal', (node?: PluginFolderNode) => scopedToggle(node, 'enable', 'local', 'personal')),
        vscode.commands.registerCommand('claudeAssets.disablePluginPersonal', (node?: PluginFolderNode) => scopedToggle(node, 'disable', 'local', 'personal'))
      ];
    })(),

    vscode.commands.registerCommand('claudeAssets.addMarketplace', async () => {
      const src = await vscode.window.showInputBox({
        title: 'Add Marketplace',
        prompt: 'GitHub repo, URL, or path',
        ignoreFocusOut: true
      });
      if (!src) return;
      if (!isSafeMarketplaceSource(src)) {
        vscode.window.showErrorMessage('Invalid marketplace source -- contains unsafe characters.');
        return;
      }
      const result = await runClaude(
        ['plugin', 'marketplace', 'add', src.trim()],
        `Adding marketplace ${src.trim()}`
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(`Added marketplace ${src.trim()}.`);
      } else {
        vscode.window.showErrorMessage(
          `Failed to add marketplace. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.removeMarketplace', async (node?: ContainerNode) => {
      const name = typeof node?.label === 'string' ? node.label : undefined;
      if (!name || !isValidMarketplaceName(name)) {
        vscode.window.showErrorMessage('Could not determine a valid marketplace name to remove.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Remove marketplace "${name}"?`,
        { modal: true, detail: `This runs: claude plugin marketplace remove ${name}` },
        'Remove'
      );
      if (confirm !== 'Remove') return;
      const result = await runClaude(
        ['plugin', 'marketplace', 'remove', name],
        `Removing marketplace ${name}`
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(`Removed marketplace ${name}.`);
      } else {
        vscode.window.showErrorMessage(
          `Failed to remove marketplace ${name}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.refreshMarketplace', async (node?: ContainerNode) => {
      const name = typeof node?.label === 'string' ? node.label : undefined;
      if (!name || !isValidMarketplaceName(name)) {
        vscode.window.showErrorMessage('Could not determine a valid marketplace name to refresh.');
        return;
      }
      const result = await runClaude(
        ['plugin', 'marketplace', 'update', name],
        `Refreshing ${name}`
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(`Refreshed source for ${name}.`);
      } else {
        vscode.window.showErrorMessage(
          `Failed to refresh marketplace ${name}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.openPluginManager', (node?: { label?: unknown; contextValue?: unknown }) => {
      const rawLabel = typeof node?.label === 'string' ? node.label : undefined;
      const contextValue = typeof node?.contextValue === 'string' ? node.contextValue : undefined;
      let preselect: string | undefined;
      if (rawLabel === '(local)') {
        preselect = '';
      } else if (rawLabel !== undefined && isValidMarketplaceName(rawLabel)) {
        preselect = rawLabel;
      }
      const scopePreselect: PluginInstallScope = contextValue === 'assetProjectPluginsRoot' ? 'project' : 'user';
      openPluginManager(context, pluginManagerDeps, preselect, scopePreselect);
    }),

    // Re-scan on configuration change
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeAssets')) {
        runScan().catch(() => { /* ignore */ });
      }
    }),

    // Re-scan when a tracked asset file is saved, so its token count updates.
    // Reliable across platforms (recursive fs.watch is unsupported on Linux).
    vscode.workspace.onDidSaveTextDocument(doc => {
      const p = doc.uri.fsPath;
      const tracked = scanRootPaths.some(root => p === root || p.startsWith(root + path.sep));
      if (!tracked) return;
      if (saveRescanTimer) clearTimeout(saveRescanTimer);
      saveRescanTimer = setTimeout(() => {
        saveRescanTimer = null;
        runScan().catch(() => { /* ignore */ });
      }, 150);
    }),

    vscode.commands.registerCommand('claudeAssets.createSkill', async (node?: GroupNode) => {
      await handleCreate(AssetType.Skill, node, 'Skill');
    }),

    vscode.commands.registerCommand('claudeAssets.createAgent', async (node?: GroupNode) => {
      await handleCreate(AssetType.Subagent, node, 'Agent');
    }),

    vscode.commands.registerCommand('claudeAssets.createCommand', async (node?: GroupNode) => {
      await handleCreate(AssetType.Command, node, 'Command');
    }),

    vscode.commands.registerCommand('claudeAssets.showSectionInfo', async (node?: { contextValue?: unknown }) => {
      const contextValue = typeof node?.contextValue === 'string' ? node.contextValue : undefined;
      const info = getSectionInfoByContextValue(contextValue);
      if (!info) {
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        info.title,
        { modal: true, detail: info.summary },
        'Open Docs'
      );
      if (choice === 'Open Docs') {
        await vscode.env.openExternal(vscode.Uri.parse(info.docUrl));
      }
    })
  );

  // Initial scan
  runScan().catch(err => {
    vscode.window.showErrorMessage(`Initial scan failed: ${err}`);
  });
}

export function deactivate(): void {
  // Nothing special needed; subscriptions are disposed by VSCode
}
