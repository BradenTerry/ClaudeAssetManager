import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { scan } from './core/scanner';
import { buildScanRoots } from './core/scanRoots';
import { readInstalledPlugins, readCatalogVersions, isOutdated, InstalledPluginInfo } from './core/pluginMetadata';
import { AssetTreeProvider } from './tree/assetTreeProvider';
import { AssetNode, PluginFolderNode } from './tree/nodes';
import { watchRoots } from './services/watcher';
import {
  getDirectories,
  getFollowSymlinks,
  getExcludeDirs,
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
          const result = await new Promise<{ ok: boolean; output: string }>(resolve => {
            execFile('claude', ['plugin', 'update', id], { timeout: 120000 }, (err, stdout, stderr) => {
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

  async function runScan(): Promise<void> {
    const registeredDirs = getDirectories();
    const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const excludeDirs = getExcludeDirs();
    const followSymlinks = getFollowSymlinks();

    const roots = buildScanRoots(homeClaudeDir, registeredDirs, workspaceDirs);
    const assets = scan(roots, { excludeDirs, followSymlinks });

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

    const meta = { installedPlugins, outdated };
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
