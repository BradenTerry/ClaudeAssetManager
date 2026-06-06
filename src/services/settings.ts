import * as vscode from 'vscode';

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
