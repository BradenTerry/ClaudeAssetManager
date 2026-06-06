<p align="center">
  <img src="media/icon.png" alt="Claude Asset Manager icon" width="128" height="128">
</p>

# Claude Asset Manager

A VSCode extension that puts every Claude Code asset on your machine in one sidebar: skills,
subagents, slash commands, memory and CLAUDE.md files, `.claude` config, and installed plugins.
It scans your global `~/.claude` directory, your installed plugins, and your projects, then
groups everything so you can find, open, and manage any asset in a few clicks.

## What it shows

Open the **Claude Asset Manager** icon in the Activity Bar to reveal two sections.

### Working Directory

This is the section that answers "what is Claude actually looking at here?" It is titled after
the folder you have open (for example `Projects (WD)`) and shows every Claude Code asset that
applies to your current workspace:

- The open folder's own `.claude` assets (CLAUDE.md, config, skills, subagents, commands) listed
  at the top.
- One folder per sub-project, each with its own CLAUDE.md, config, and asset groups.
- Git worktrees grouped under a **Worktrees** folder so they do not duplicate a project's assets.

In other words, the whole set of skills, agents, commands, memory, and config Claude can pull
into a session for the directory you are working in, laid out in one place.

### Global

Your machine-wide `~/.claude` assets:

- CLAUDE.md and config files first, then **Skills**, **Subagents**, and **Commands**.
- A **Projects** folder holding per-project memory.
- A **Plugins** folder listing every installed plugin, nested under its source marketplace with
  its version, and an `N Updates available` indicator when a newer version exists in your local
  catalog (no network calls are made). Each plugin shows its enabled/disabled state: enabled
  plugins render a green icon, disabled plugins a dimmed icon with a ` (disabled)` suffix. Every
  configured marketplace (from `known_marketplaces.json`) appears here even with no installed
  plugins yet, so an added marketplace shows up immediately and lists `(no plugins installed)`. The
  **Plugins** folder and each marketplace also show an `X/Y plugins enabled` summary.

### Details that keep the tree clean

- **Full file trees for skills and agents** mirror their real directories, so every file and
  subdirectory is shown, not just the entry file.
- **Scoped discovery** recognizes config only inside a `.claude/` directory, picks up CLAUDE.md
  only at sensible locations (global, a project or worktree root, or inside `.claude/`), follows
  symlinks, and skips noise like `node_modules`, `.git`, `bin`, and `obj`.

## Using it

### Opening assets

- **Click** any file to open it (markdown opens in the rendered preview; config opens in the editor).
- **Right-click** a file for **Open File**, **Open Preview**, **Reveal in File Manager**, and **Delete**.
- **Right-click** a folder for **Reveal in File Manager** and **Delete** (non-plugin folders).
- **Delete** moves the item to the system trash and asks for confirmation first.

### Managing plugins

Plugin actions shell out to the Claude Code CLI and require `claude` on your `PATH`. After any
change, restart your Claude Code session to apply it.

- **Enable Plugin** / **Disable Plugin**: right-click a plugin to toggle it (runs
  `claude plugin enable|disable <id>`). The menu shows whichever action applies to the current state.
- **Update Plugin**: right-click an out-of-date plugin.
- **Update Plugins**: right-click a marketplace folder to update every out-of-date plugin from it.
- **Update All Plugins**: right-click the **Plugins** folder.
- **Uninstall Plugin**: right-click a plugin.
- **Add Plugin**: click the inline `+` (or right-click) on a marketplace folder to browse every
  plugin available from that source that you have not installed, pick one or more, and install them
  (runs `claude plugin install <name@marketplace>`).
- **Add Marketplace**: right-click the **Plugins** folder and enter a GitHub repo, URL, or path
  (runs `claude plugin marketplace add <source>`).
- **Refresh Source**: right-click a marketplace folder to pull the latest from its source
  (runs `claude plugin marketplace update <name>`).
- **Remove Marketplace**: right-click a marketplace folder (runs `claude plugin marketplace remove <name>`).

Each action confirms before running where it is destructive and shows the exact command it will
execute. Files inside a plugin cannot be deleted individually; uninstall the plugin instead. The
synthetic `(local)` marketplace group cannot be refreshed or removed.

### Refresh

**Refresh** in the section title bar rescans everything.

## Settings

- `claudeAssets.directories`: additional directories to scan recursively for projects.
- `claudeAssets.followSymlinks`: follow symbolic links while scanning (default `true`).
- `claudeAssets.excludeDirs`: directory names to skip during recursive scans.
- `claudeAssets.maxDepth`: how deep to search for a `.claude` directory (default `6`, minimum `1`).
  Once a `.claude` directory is found, its entire contents are scanned regardless of this limit.
- `claudeAssets.markdownOpenMode`: how a Markdown asset opens on single click -- `default` (VS Code's
  default editor), `code` (source editor), `preview` (rendered preview), or `split` (source and
  preview side by side). Defaults to `default`.

## Install from the Marketplace

Search for "Claude Asset Manager" in the Extensions view, or run:

```bash
code --install-extension BradenTerry.claude-asset-manager
```

Or download the `.vsix` from the [latest release](https://github.com/BradenTerry/ClaudeAssetManager/releases),
then in the Extensions view use the `...` menu and choose **Install from VSIX**.

## Run from a GitHub clone

```bash
git clone https://github.com/BradenTerry/ClaudeAssetManager.git
cd ClaudeAssetManager
npm install
npm run compile   # type-check and build to out/
```

Open the folder in VSCode and press `F5` to launch the Extension Development Host. The Claude
Asset Manager icon appears in the Activity Bar of the new window, with the Global and Working
Directory sections.

Other useful scripts:

```bash
npm test          # run the Mocha test suite
npm run bundle    # produce the bundled dist/extension.js
npm run package   # build a .vsix
```

## Requirements

- VSCode 1.90 or newer.
- For plugin update and uninstall actions, the [Claude Code](https://claude.com/claude-code) CLI
  (`claude`) must be on your `PATH`. On macOS, launch VSCode from a terminal so the extension host
  inherits your shell `PATH`; otherwise the CLI commands may not find `claude`.

## Contributing

Contributions are welcome. To get started:

1. **Fork and clone** the repository, then create a branch off `main`:

   ```bash
   git clone https://github.com/<your-username>/ClaudeAssetManager.git
   cd ClaudeAssetManager
   npm install
   git checkout -b my-change
   ```

2. **Make your change** in `src/`. Use spaces for indentation and match the existing TypeScript
   style. The codebase layout is described in [PROJECT_MAP.md](PROJECT_MAP.md).

3. **Build and test** before opening a PR:

   ```bash
   npm run compile   # type-check the project
   npm test          # run the Mocha test suite
   ```

   Add or update tests under `test/` for any behavior you change.

4. **Run it locally** with `F5` (Extension Development Host) to confirm your change works in the UI.

5. **Open a pull request** against `main`. Keep the change focused, describe what it does and why,
   and reference any related issue. CI runs the build and tests on each PR.

For larger changes, open an issue first to discuss the approach. Bug reports and feature requests
are also welcome in the [issue tracker](https://github.com/BradenTerry/ClaudeAssetManager/issues).

## Issues and support

Open an issue at
[github.com/BradenTerry/ClaudeAssetManager/issues](https://github.com/BradenTerry/ClaudeAssetManager/issues).

## License

[MIT](LICENSE)
