import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { scan } from './core/scanner';
import { buildScanRoots } from './core/scanRoots';
import { readInstalledPlugins, readCatalogLastUpdated, isOutdated } from './core/pluginMetadata';
import { AssetTreeProvider } from './tree/assetTreeProvider';
import { AssetNode } from './tree/nodes';
import { watchRoots } from './services/watcher';
import {
  getDirectories,
  getFollowSymlinks,
  getExcludeDirs,
  addDirectory,
  removeDirectory
} from './services/settings';

export function activate(context: vscode.ExtensionContext): void {
  const homeClaudeDir = path.join(os.homedir(), '.claude');
  const globalProvider = new AssetTreeProvider('global');
  const workingDirProvider = new AssetTreeProvider('working-directory');

  let disposeWatcher: (() => void) | null = null;

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
    const catalogMap = readCatalogLastUpdated(catalogCacheJsonPath);
    const outdated = new Set<string>();
    for (const [name, info] of installedPlugins) {
      if (isOutdated(info, catalogMap.get(name))) {
        outdated.add(name);
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

    vscode.commands.registerCommand('claudeAssets.openFile', (filePath: string) => {
      const uri = vscode.Uri.file(filePath);
      vscode.window.showTextDocument(uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not open file: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.openPreview', (filePath: string) => {
      const uri = vscode.Uri.file(filePath);
      vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not open preview: ${err}`);
      });
    }),

    vscode.commands.registerCommand('claudeAssets.revealInOS', (filePath: string) => {
      const uri = vscode.Uri.file(filePath);
      vscode.commands.executeCommand('revealFileInOS', uri).then(undefined, err => {
        vscode.window.showErrorMessage(`Could not reveal file: ${err}`);
      });
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
