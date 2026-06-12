import * as vscode from 'vscode';
import { MarkdownOpenMode, normalizeMarkdownOpenMode } from '../core/markdownOpen';

const CONFIG_SECTION = 'claudeAssets';

export function getDirectories(): string[] {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string[]>('directories', []);
}

export function getFollowSymlinks(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('followSymlinks', true);
}

export function getExcludeDirs(): string[] {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string[]>('excludeDirs', [
    'node_modules', '.git', 'bin', 'obj', 'dist', 'target', '.venv', 'venv', '.idea', '.vs'
  ]);
}

export function getMaxDepth(): number {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('maxDepth', 6);
}

export type AssetSection = 'global' | 'working-directory';

function tokenUsageKey(section: AssetSection): string {
  return section === 'global' ? 'showTokenUsageGlobal' : 'showTokenUsageWorkingDirectory';
}

export function getShowTokenUsage(section: AssetSection): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(tokenUsageKey(section), false);
}

export async function setShowTokenUsage(section: AssetSection, value: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update(tokenUsageKey(section), value, vscode.ConfigurationTarget.Global);
}

// Worktree visibility is a Working Directory-only concern (other worktrees only ever
// appear under that section). Default hidden: they are separate checkouts, usually
// duplicating the main tree, so they are noise unless explicitly requested.
export function getShowWorktrees(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('showWorktrees', false);
}

export async function setShowWorktrees(value: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update('showWorktrees', value, vscode.ConfigurationTarget.Global);
}

export function getMarkdownOpenMode(): MarkdownOpenMode {
  return normalizeMarkdownOpenMode(
    vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('markdownOpenMode', 'default')
  );
}

export async function addDirectory(dirPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = config.get<string[]>('directories', []);
  if (!current.includes(dirPath)) {
    await config.update('directories', [...current, dirPath], vscode.ConfigurationTarget.Global);
  }
}

export async function removeDirectory(dirPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = config.get<string[]>('directories', []);
  const updated = current.filter(d => d !== dirPath);
  await config.update('directories', updated, vscode.ConfigurationTarget.Global);
}
