# Claude Asset Manager

Browse and manage every Claude Code asset on your machine from one VSCode sidebar: skills,
agents, slash commands, memory and CLAUDE.md files, `.claude` JSON config, and installed
plugins. Assets are discovered across your global `~/.claude` directory, your installed
plugins, and all of your projects, then grouped so you can find, open, and manage any of them
quickly.

## Features

- **Unified sidebar** with two sections:
  - **Global**: your `~/.claude` assets. CLAUDE.md and config files first, then `skills`,
    `agents`, and `commands`, then a `projects` folder (per-project memory), then a `plugins`
    folder.
  - **Working Directory**: titled after the folder you have open (for example `Projects (WD)`).
    Shows the open folder's own `.claude` assets, then one folder per sub-project. Git worktrees
    are grouped under a `worktrees` folder so they do not duplicate a project's assets.
- **Full file trees for skills and agents.** The `skills` and `agents` groups mirror their real
  directories, so every file and subdirectory under a skill or agent is shown, not just the
  entry file.
- **Plugin management** driven by your installed plugin list (`installed_plugins.json`):
  - Every installed plugin appears, nested under its source marketplace, with its version.
  - Each plugin folder expands to its installed files.
  - Update indicators (`N Updates available`) at the plugins, marketplace, and individual plugin
    levels, based on comparing the installed version with the local plugin catalog. No network
    calls are made by the extension.
  - Right-click to **Update** (one plugin, a whole marketplace, or all) or **Uninstall**, which
    run the Claude Code CLI for you.
- **Open, reveal, and delete** from the tree, with confirmation for destructive actions.
- **Scoped discovery** that avoids noise:
  - Config is recognized only inside a `.claude/` directory (a project's
    `.vscode/settings.json` is ignored).
  - CLAUDE.md is picked up only at the global location, at a project or worktree root, or inside
    a `.claude/` directory, so a CLAUDE.md shipped deep in an app's source tree is ignored.
  - Follows symlinks (a dotfiles-symlinked `~/.claude` is found) and skips noise directories such
    as `node_modules`, `.git`, `bin`, and `obj`.

## Installation

- **Marketplace**: search for "Claude Asset Manager" in the Extensions view, or run:

  ```bash
  code --install-extension BradenTerry.claude-asset-manager
  ```

- **From a VSIX**: download the `.vsix` from the [latest release](https://github.com/BradenTerry/ClaudeAssetManager/releases),
  then in VSCode open the Extensions view, use the `...` menu, and choose **Install from VSIX**.

Open the **Claude Asset Manager** icon in the Activity Bar to reveal the Global and Working
Directory sections.

## Usage

### Opening assets

- **Click** any file to open it with your default editor for that file type.
- **Right-click** a file for **Open File**, **Open Preview** (for markdown), **Reveal in File
  Manager**, and **Delete**.
- **Right-click** a folder for **Reveal in File Manager**, and **Delete** for non-plugin folders.
- **Delete** moves the item to the system trash (recoverable) and asks for confirmation first.

### Managing plugins

Plugin actions shell out to the Claude Code CLI and require `claude` to be available on your
`PATH` (see Requirements). After any change, restart your Claude Code session to apply it.

- **Update Plugin**: right-click an out-of-date plugin.
- **Update Plugins**: right-click a marketplace folder to update every out-of-date plugin from
  that source.
- **Update All Plugins**: right-click the `plugins` folder.
- **Uninstall Plugin**: right-click a plugin.

Each action confirms before running and shows the exact command it will execute. Files inside a
plugin cannot be deleted individually; uninstall the plugin instead.

### Section actions

- **Refresh** (title bar) rescans everything.

## Settings

- `claudeAssets.directories`: additional directories to scan recursively for projects.
- `claudeAssets.followSymlinks`: follow symbolic links while scanning (default `true`).
- `claudeAssets.excludeDirs`: directory names to skip during recursive scans.

## Requirements

- VSCode 1.90 or newer.
- For plugin update and uninstall actions, the [Claude Code](https://claude.com/claude-code) CLI
  (`claude`) must be on your `PATH`. On macOS, launch VSCode from a terminal so the extension host
  inherits your shell `PATH`; otherwise the CLI commands may not find `claude`.

## Development

```bash
git clone https://github.com/BradenTerry/ClaudeAssetManager.git
cd ClaudeAssetManager
npm install
npm run compile   # type-check and build to out/
npm test          # run the Mocha test suite
npm run bundle    # produce the bundled dist/extension.js
npm run package   # build a .vsix
```

Open the folder in VSCode and press `F5` to launch the Extension Development Host.

The discovery, parsing, and classification logic lives in `src/core/` and has no `vscode`
dependency, so it is unit-tested without the extension host. The tree mapping is in `src/tree/`
and command wiring in `src/extension.ts`. See `PROJECT_MAP.md` for the full architecture.

Releases are automated: publishing a GitHub Release builds, tests, packages, and publishes the
extension to the Marketplace.

## Issues and support

Found a bug or have a feature request? Please open an issue at
[github.com/BradenTerry/ClaudeAssetManager/issues](https://github.com/BradenTerry/ClaudeAssetManager/issues).

## License

[MIT](LICENSE)
