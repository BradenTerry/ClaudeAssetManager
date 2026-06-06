# Claude Asset Manager

A VSCode extension that discovers and browses every Claude Code asset on your machine in one
place: skills, subagents, slash commands, memory and CLAUDE.md instruction files, and `.claude`
JSON config. It is a read-and-open tool, so clicking an asset opens the real file in your editor
(markdown opens in the rendered preview); the extension never edits files on its own.

## Why

There is no built-in way to see every skill, agent, command, and config across your global
`~/.claude` directory, your installed plugins, and all of your projects at once. This extension
puts them in a single sidebar, grouped sensibly, so you can find and open any of them quickly.

## Features

- Two collapsible sidebar sections:
  - **Global** -- your `~/.claude` assets: CLAUDE.md and config files, then Skills, Subagents,
    and Commands, then a **Projects** folder with per-project memory, then a **Plugins** folder.
  - **Working Directory** -- titled after the folder you have open (for example `Projects (WD)`).
    Shows the open folder's own `.claude` assets at the top, then a folder per sub-project.
- **Installed plugins** are listed with their version, and flagged with an "update available"
  indicator when the local plugin catalog has a newer timestamp than what is installed. No
  network calls are made.
- **Git worktrees** are grouped under a `Worktrees` folder inside each project, so worktree
  copies do not clutter or duplicate the project's assets.
- **Scoped discovery** that avoids noise:
  - Config is only recognized inside a `.claude/` directory (a project's `.vscode/settings.json`
    is ignored).
  - CLAUDE.md is only picked up at the global location, at a project or worktree root, or inside
    a `.claude/` directory. A CLAUDE.md your app ships deep in its source tree is ignored.
- Follows symlinks (so a dotfiles-symlinked `~/.claude/skills` is found) and skips noise
  directories like `node_modules`, `.git`, `bin`, and `obj`.

## Requirements

- VSCode 1.90 or newer.
- Node.js and npm (for building from source).

## Getting started (from source)

```bash
git clone https://github.com/BradenTerry/ClaudeAssetManager.git
cd ClaudeAssetManager
npm install
npm run compile
```

Then open the folder in VSCode and press `F5` to launch the Extension Development Host. The
Claude Asset Manager icon appears in the Activity Bar with the Global and Working Directory
sections.

## Usage

- Click any asset to open it (markdown opens in preview; JSON config opens in the editor).
- Right-click an asset for **Open File**, **Open Preview**, or **Reveal in File Manager**.
- Use the section title buttons to **Refresh** the scan or **Add Directory** to register an
  extra folder to scan for projects.

## Settings

- `claudeAssets.directories` -- additional directories to scan recursively for projects.
- `claudeAssets.followSymlinks` -- follow symbolic links while scanning (default `true`).
- `claudeAssets.excludeDirs` -- directory names to skip during recursive scans.

## Development

```bash
npm run watch   # recompile on change
npm test        # run the Mocha test suite
```

The discovery, parsing, and classification logic lives in `src/core/` and has no `vscode`
dependency, so it is unit-tested without the extension host. See `PROJECT_MAP.md` for the full
architecture.

## License

No license has been set for this project yet.
