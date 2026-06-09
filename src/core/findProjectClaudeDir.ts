import * as fs from 'fs';
import * as path from 'path';

export interface ProjectClaudeDirResult {
  projectDir: string;
  projectClaudeDir: string;
}

/**
 * Returns the first directory in `workspaceDirs` whose `<dir>/.claude`
 * exists and is a directory (not a file). Returns undefined when none qualify.
 *
 * This is a pure, vscode-free helper so it can be unit-tested without mocking.
 */
export function findProjectClaudeDir(workspaceDirs: string[]): ProjectClaudeDirResult | undefined {
  for (const dir of workspaceDirs) {
    const claudeDir = path.join(dir, '.claude');
    try {
      if (fs.existsSync(claudeDir) && fs.statSync(claudeDir).isDirectory()) {
        return { projectDir: dir, projectClaudeDir: claudeDir };
      }
    } catch {
      // stat failed; skip
    }
  }
  return undefined;
}
