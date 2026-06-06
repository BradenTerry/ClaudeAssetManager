import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { scan } from './core/scanner';
import { buildScanRoots } from './core/scanRoots';
import { readInstalledPlugins, readCatalogVersions, readCatalogPlugins, isOutdated, readEnabledPlugins, readKnownMarketplaces, InstalledPluginInfo } from './core/pluginMetadata';
import { isValidPluginId, isValidMarketplaceName, isSafeMarketplaceSource } from './core/pluginValidation';
import { AssetTreeProvider } from './tree/assetTreeProvider';
import { AssetNode, PluginFolderNode, ContainerNode } from './tree/nodes';
import { watchRoots } from './services/watcher';
import {
  getDirectories,
  getFollowSymlinks,
  getExcludeDirs,
  getMaxDepth,
  getMarkdownOpenMode,
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

  let disposeWatcher: (() => void) | null = null;
  // Latest set of outdated plugins, refreshed on every scan; drives "Update all".
  let outdatedPlugins: InstalledPluginInfo[] = [];

  /**
   * Run `claude plugin update <id>` for each id sequentially behind a progress
   * notification. Returns the ids that failed along with their error output.
   */
  async function runPluginUpdates(ids: string[]): Promise<{ failed: { id: string; output: string }[] }> {
    const failed: { id: string; output: string }[] = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Claude Assets: updating plugins',
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
      vscode.window.showInformationMessage('Claude Assets: no plugin updates available.');
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
        `Claude Assets: updated ${ids.length} plugin${ids.length === 1 ? '' : 's'}. Restart your Claude Code session to apply.`
      );
    } else {
      const names = failed.map(f => f.id).join(', ');
      vscode.window.showErrorMessage(`Claude Assets: failed to update ${names}. ${failed[0].output}`);
    }
  }

  /** Run a claude CLI command behind a progress notification. Resolves with ok+output. */
  function runClaude(args: string[], title: string): Promise<{ ok: boolean; output: string }> {
    return Promise.resolve(
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        () => new Promise<{ ok: boolean; output: string }>(resolve => {
          execFile('claude', args, { timeout: 120000, shell: process.platform === 'win32' }, (err, so, se) =>
            resolve({ ok: !err, output: `${so ?? ''}${se ?? ''}`.trim() }));
        })
      )
    );
  }

  async function runScan(): Promise<void> {
    const registeredDirs = getDirectories();
    const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const excludeDirs = getExcludeDirs();
    const followSymlinks = getFollowSymlinks();
    const maxDepth = getMaxDepth();

    const roots = buildScanRoots(homeClaudeDir, registeredDirs, workspaceDirs);
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
    const meta = { installedPlugins, outdated, enabled: enabledMap, marketplaces };
    globalProvider.update(assets, meta);
    workingDirProvider.update(assets, meta);

    // Re-watch
    if (disposeWatcher) {
      disposeWatcher();
    }
    disposeWatcher = watchRoots(roots, () => {
      runScan().catch(() => { /* ignore */ });
    });
  }

  // Register the two sidebar sections as separate views
  const globalView = vscode.window.createTreeView('claudeAssets.global', {
    treeDataProvider: globalProvider,
    showCollapseAll: true
  });
  const workingDirView = vscode.window.createTreeView('claudeAssets.workingDirectory', {
    treeDataProvider: workingDirProvider,
    showCollapseAll: true
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

  // Commands
  context.subscriptions.push(
    globalView,
    workingDirView,
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateWorkingDirTitle()),

    vscode.commands.registerCommand('claudeAssets.refresh', () => {
      runScan().catch(err => {
        vscode.window.showErrorMessage(`Claude Assets: scan failed: ${err}`);
      });
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
        vscode.window.showErrorMessage('Claude Assets: could not determine which plugin to update.');
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
        vscode.window.showErrorMessage('Claude Assets: could not determine which marketplace to update.');
        return;
      }
      const ids = outdatedPlugins.filter(p => (p.marketplace || '(local)') === mk).map(p => p.id);
      await performUpdates(ids, ids.length > 0 ? `Plugins to update in ${mk}:\n${ids.join('\n')}` : '');
    }),

    vscode.commands.registerCommand('claudeAssets.uninstallPlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId ?? node?.pluginName;
      if (!id) {
        vscode.window.showErrorMessage('Claude Assets: could not determine which plugin to uninstall.');
        return;
      }
      if (!isValidPluginId(id)) {
        vscode.window.showErrorMessage(`Claude Assets: invalid plugin id "${id}".`);
        return;
      }
      const name = node?.pluginName ?? id;
      const confirm = await vscode.window.showWarningMessage(
        `Uninstall plugin "${name}"?`,
        { modal: true, detail: `This runs: claude plugin uninstall ${id}` },
        'Uninstall'
      );
      if (confirm !== 'Uninstall') {
        return;
      }
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Claude Assets: uninstalling ${name}`,
          cancellable: false
        },
        () => new Promise<{ ok: boolean; output: string }>(resolve => {
          // On Windows the CLI is a `claude.cmd` shim; execFile only resolves it via a shell.
          execFile('claude', ['plugin', 'uninstall', id], { timeout: 120000, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
            resolve({ ok: !err, output: `${stdout ?? ''}${stderr ?? ''}`.trim() });
          });
        })
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(
          `Claude Assets: uninstalled ${name}. Restart your Claude Code session to apply.`
        );
      } else {
        vscode.window.showErrorMessage(
          `Claude Assets: failed to uninstall ${name}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.deleteFile', async (arg: unknown) => {
      const targetPath = resolveFsPath(arg);
      if (!targetPath) {
        vscode.window.showErrorMessage('Could not delete: no path.');
        return;
      }
      // Plugin files are managed by Claude -- never let the user delete inside the plugins tree.
      const pluginsRoot = path.join(homeClaudeDir, 'plugins');
      if (targetPath === pluginsRoot || targetPath.startsWith(pluginsRoot + path.sep)) {
        vscode.window.showInformationMessage(
          'Plugin files are managed by Claude. Right-click the plugin and choose "Uninstall Plugin" instead.'
        );
        return;
      }
      let isDir: boolean;
      try {
        isDir = fs.statSync(targetPath).isDirectory();
      } catch {
        vscode.window.showErrorMessage(`Could not delete: ${targetPath} no longer exists.`);
        runScan().catch(() => { /* ignore */ });
        return;
      }
      const name = path.basename(targetPath);
      const kind = isDir ? 'folder' : 'file';
      const confirm = await vscode.window.showWarningMessage(
        `Delete ${kind} "${name}"?`,
        { modal: true, detail: `${targetPath}\n\nThis moves it to the trash.` },
        'Delete'
      );
      if (confirm !== 'Delete') {
        return;
      }
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), { recursive: true, useTrash: true });
      } catch (err) {
        vscode.window.showErrorMessage(`Could not delete ${name}: ${err}`);
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

    vscode.commands.registerCommand('claudeAssets.removeDirectory', async (node?: AssetNode) => {
      const dirs = getDirectories();
      if (dirs.length === 0) {
        vscode.window.showInformationMessage('No registered directories to remove.');
        return;
      }
      const picked = await vscode.window.showQuickPick(dirs, {
        placeHolder: 'Select a directory to remove'
      });
      if (picked) {
        await removeDirectory(picked);
        runScan().catch(() => { /* ignore */ });
      }
    }),

    vscode.commands.registerCommand('claudeAssets.enablePlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId;
      if (!id || !isValidPluginId(id)) {
        vscode.window.showErrorMessage('Claude Assets: could not determine a valid plugin id to enable.');
        return;
      }
      const result = await runClaude(['plugin', 'enable', id], `Claude Assets: enabling ${id}`);
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(
          `Claude Assets: enabled ${id}. Restart your Claude Code session to apply.`
        );
      } else {
        vscode.window.showErrorMessage(
          `Claude Assets: failed to enable ${id}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.disablePlugin', async (node?: PluginFolderNode) => {
      const id = node?.pluginId;
      if (!id || !isValidPluginId(id)) {
        vscode.window.showErrorMessage('Claude Assets: could not determine a valid plugin id to disable.');
        return;
      }
      const result = await runClaude(['plugin', 'disable', id], `Claude Assets: disabling ${id}`);
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(
          `Claude Assets: disabled ${id}. Restart your Claude Code session to apply.`
        );
      } else {
        vscode.window.showErrorMessage(
          `Claude Assets: failed to disable ${id}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.addMarketplace', async () => {
      const src = await vscode.window.showInputBox({
        title: 'Add Marketplace',
        prompt: 'GitHub repo, URL, or path',
        ignoreFocusOut: true
      });
      if (!src) return;
      if (!isSafeMarketplaceSource(src)) {
        vscode.window.showErrorMessage('Claude Assets: invalid marketplace source -- contains unsafe characters.');
        return;
      }
      const result = await runClaude(
        ['plugin', 'marketplace', 'add', src.trim()],
        `Claude Assets: adding marketplace ${src.trim()}`
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(`Claude Assets: added marketplace ${src.trim()}.`);
      } else {
        vscode.window.showErrorMessage(
          `Claude Assets: failed to add marketplace. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.removeMarketplace', async (node?: ContainerNode) => {
      const name = typeof node?.label === 'string' ? node.label : undefined;
      if (!name || !isValidMarketplaceName(name)) {
        vscode.window.showErrorMessage('Claude Assets: could not determine a valid marketplace name to remove.');
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
        `Claude Assets: removing marketplace ${name}`
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(`Claude Assets: removed marketplace ${name}.`);
      } else {
        vscode.window.showErrorMessage(
          `Claude Assets: failed to remove marketplace ${name}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.refreshMarketplace', async (node?: ContainerNode) => {
      const name = typeof node?.label === 'string' ? node.label : undefined;
      if (!name || !isValidMarketplaceName(name)) {
        vscode.window.showErrorMessage('Claude Assets: could not determine a valid marketplace name to refresh.');
        return;
      }
      const result = await runClaude(
        ['plugin', 'marketplace', 'update', name],
        `Claude Assets: refreshing ${name}`
      );
      await runScan();
      if (result.ok) {
        vscode.window.showInformationMessage(`Claude Assets: refreshed source for ${name}.`);
      } else {
        vscode.window.showErrorMessage(
          `Claude Assets: failed to refresh marketplace ${name}. ${result.output || 'unknown error'}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeAssets.browseMarketplace', async (node?: ContainerNode) => {
      const mk = typeof node?.label === 'string' ? node.label : undefined;
      if (!mk || !isValidMarketplaceName(mk)) {
        vscode.window.showErrorMessage('Claude Assets: could not determine a valid marketplace name to browse.');
        return;
      }
      const catalogPath = path.join(homeClaudeDir, 'plugins', 'plugin-catalog-cache.json');
      const installedPath = path.join(homeClaudeDir, 'plugins', 'installed_plugins.json');
      const installed = readInstalledPlugins(installedPath);
      const installedIds = new Set([...installed.values()].map(i => i.id));
      const available = readCatalogPlugins(catalogPath)
        .filter(p => p.marketplace === mk && !installedIds.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (available.length === 0) {
        vscode.window.showInformationMessage(
          `Claude Assets: no new plugins available in ${mk}. (Try Refresh Source to update the catalog.)`
        );
        return;
      }
      const picks = await vscode.window.showQuickPick(
        available.map(p => ({ label: p.name, description: p.version, detail: p.description, id: p.id })),
        { canPickMany: true, title: `Add plugins from ${mk}`, placeHolder: 'Select plugins to install' }
      );
      if (!picks || picks.length === 0) return;
      const ids = picks.map(p => p.id).filter(isValidPluginId);
      const failed: { id: string; output: string }[] = [];
      for (const id of ids) {
        const r = await runClaude(['plugin', 'install', id], `Claude Assets: installing ${id}`);
        if (!r.ok) {
          failed.push({ id, output: r.output || 'unknown error' });
        }
      }
      await runScan();
      const installed2 = ids.length - failed.length;
      if (failed.length === 0) {
        vscode.window.showInformationMessage(
          `Claude Assets: installed ${installed2} plugin${installed2 === 1 ? '' : 's'} from ${mk}. Restart your Claude Code session to apply.`
        );
      } else {
        const names = failed.map(f => f.id).join(', ');
        vscode.window.showErrorMessage(
          `Claude Assets: failed to install ${names}. ${failed[0].output}`
        );
      }
    }),

    // Re-scan on configuration change
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeAssets')) {
        runScan().catch(() => { /* ignore */ });
      }
    })
  );

  // Initial scan
  runScan().catch(err => {
    vscode.window.showErrorMessage(`Claude Assets: initial scan failed: ${err}`);
  });
}

export function deactivate(): void {
  // Nothing special needed; subscriptions are disposed by VSCode
}
