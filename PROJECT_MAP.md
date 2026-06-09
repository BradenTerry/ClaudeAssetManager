# Claude Asset Manager

A native VSCode extension that discovers and browses every Claude Code asset on a machine
(skills, subagents, slash commands, memory/CLAUDE.md, and `.claude` JSON config) in two
collapsible sidebar sections: **Global** and a **Working Directory** section titled after the
open folder (e.g. `Projects (WD)`). Markdown opens in the rendered preview on click; config
opens in the editor. Beyond read-and-open, the extension can create new skills, subagents, and
slash commands from the tree (inline `+` / right-click on a type-group folder).

## Stack
- TypeScript (strict), compiled with tsc to CommonJS in `out/` (`main` = `out/extension.js`).
- `yaml` for frontmatter; `JSON.parse` for config.
- Mocha + Node assert with temp-directory fixtures (141 tests). Core is `vscode`-free and
  fully unit-tested; the tree/extension layers are exercised via the pure descriptor functions.

## Architecture
- `src/core/` -- ZERO `vscode` import. Discovery, parsing, classification, plugin metadata.
  Home dir + paths are injected so tests never touch the real `~/.claude`.
  - `types.ts` -- AssetType, AssetScope, `ClaudeAsset` (incl. `rootPath`), ScanRoot, ScanOptions.
  - `scanRoots.ts` -- `buildScanRoots(home, registeredDirs, workspaceDirs)`: global `~/.claude`,
    plugins `~/.claude/plugins/cache` (installed only), memory `~/.claude/projects`, plus
    workspace + registered roots.
  - `scanner.ts` -- walks roots, follows symlinks (realpath + visited-set cycle guard), prunes
    noise dirs; the global home root skips its `plugins/` and `projects/` subtrees (handled by
    dedicated roots). `deriveScope` keeps memory Global; Config and CLAUDE.md are restricted (below).
    `ScanOptions.maxDepth` bounds how far the walker descends through non-`.claude` dirs while
    searching for a `.claude` dir; entering a `.claude` dir flips to "inside" and scans its whole
    subtree unlimited. Special roots (global/plugins/memory, or a root named `.claude`) start inside.
    `maxDepth` is optional (undefined = unlimited), so omitting it preserves old behavior.
  - `assetFactory.ts` -- `recognizeAssetType` + `buildAsset`; parses `tools`/`allowed-tools`.
  - `assetCreation.ts` -- vscode-free asset scaffolding. `isValidAssetName` (rejects empty, path
    separators, `..`, leading dot; pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$`), `assetTemplate(type,
    name)` (frontmatter + skeleton per type; throws for unsupported types), `newAssetRelativePath`
    (Skill -> `<name>/SKILL.md`, Subagent/Command -> `<name>.md`), and `createAsset(type,
    segmentDir, name)` (validates, refuses an existing target, `mkdir -p` parent, writes the
    template, returns the absolute path).
  - `containerDerivations.ts` -- `derivePluginName`, `deriveProjectInfo` ({project, worktree}),
    `deriveMemoryProject`, `isRootLevelAsset`.
  - `pluginMetadata.ts` -- `readInstalledPlugins`, `readCatalogVersions`, `readCatalogPlugins`
    (catalog cache -> available `CatalogPlugin[]` for browsing), `isOutdated`, `readEnabledPlugins`
    (settings.json `enabledPlugins`, id -> bool; disabled only when explicit false),
    `readProjectEnabledPlugins(settingsPath, settingsLocalPath)` -> `Map<id, ProjectPluginEnablement>`
    (merges a project's `.claude/settings.json` as scope `project` with `.claude/settings.local.json`
    as scope `local`; local wins, types `PluginScope` / `ProjectPluginEnablement`),
    `readKnownMarketplaces` (known_marketplaces.json -> all configured marketplaces).
  - `pluginValidation.ts` -- `isValidPluginId`, `isValidMarketplaceName`, `isSafeMarketplaceSource`,
    `normalizePluginScope` (accepts only `user`/`project`/`local`), `buildScopedPluginArgs(op, id, scope)`
    -> `['plugin', op, id, '--scope', scope]`; vscode-free guards that sanitize every dynamic arg before
    it is passed to the `claude` CLI.
  - `findProjectClaudeDir.ts` -- pure `findProjectClaudeDir(workspaceDirs)` returns the first folder
    whose `<dir>/.claude` exists as a directory, as `{ projectDir, projectClaudeDir }`, else undefined.
    Drives both the Working Directory Plugins folder and the cwd for project/local-scoped CLI ops.
  - `frontmatter.ts` -- YAML frontmatter split. (Collision detection was removed as noise.)
- `src/tree/`
  - `nodeDescriptors.ts` -- pure `buildTreeNodes(assets, pluginMeta?)` returns the nested
    descriptor tree (no `vscode`). Node kinds: Container, PluginFolder, Group, Asset,
    WorktreesFolder, WorktreeNameFolder.
  - `nodes.ts` -- maps descriptors to `vscode.TreeItem` subclasses.
  - `assetTreeProvider.ts` -- one `AssetTreeProvider(section)` per sidebar section; its roots are
    the children of the matching top-level container ('global' | 'working-directory').
- `src/services/` -- `settings.ts` (read/write `claudeAssets.directories`), `watcher.ts`
  (debounced fs.watch over scan roots).
- `src/extension.ts` -- `activate`: two views, file + plugin commands, watcher; titles the Working
  Directory view after the open folder + ` (WD)`; reads plugin metadata + enabled state each scan
  (no network). Plugin/marketplace mutations shell out via a `runClaude(args, title, cwd?)` helper
  (`execFile claude`), validating every dynamic arg through `pluginValidation` first. Scope-aware
  ops (enable/disable/install at `user`/`project`/`local`) run with `cwd` = the `.claude`-owning
  workspace folder (`currentProjectDir`, from `findProjectClaudeDir`) so project/local writes land
  in the right `.claude`; `user` scope runs cwd-independent. The Plugin Manager webview
  (`src/webview/pluginManager*.ts`) carries a scope selector whose value flows back through these ops.

## Tree structure
- The Skills, Subagents, and Commands type groups are always rendered (even when empty) under
  Global (driven by `PluginMetadataOptions.globalClaudeDir`) and under the active
  `.claude`-owning working-directory project (driven by `projectClaudeDir`), so the first asset
  of a kind can be created. Each carries a `createTargetDir` (its segment dir, `<claude>/skills`
  etc.) consumed by the create commands. Empty groups are NOT injected into worktrees, memory
  contexts, sub-projects, or the plugin asset-derived fallback. Group `contextValue` is
  type-specific: `assetGroupSkills` / `assetGroupAgents` / `assetGroupCommands` / `assetGroupMemory`.
- **Global** section: flat `CLAUDE.md` + config leaves, then type groups (Skills, Subagents,
  Commands), then a **Projects** folder holding per-project memory (`~/.claude/projects/*/memory`),
  then a **Plugins** folder. Plugins are grouped under their source marketplace (every configured
  marketplace from `known_marketplaces.json` shows, even with no installed plugins -> `(no plugins
  installed)`). Each plugin shows version, an "update available" indicator, and enabled/disabled
  state (green vs dimmed icon + ` (disabled)`). The Plugins root and each marketplace render an
  `X/Y plugins enabled` summary (joined with any updates text via ` · `). Marketplace nodes offer
  Add Plugin (browse catalog), Refresh Source, Remove; the Plugins root offers Add Marketplace.
- **Working Directory** section: the scan root's own `.claude` assets rendered flat at the top,
  then one folder per sub-project (sorted alpha), then (last) a **Plugins** folder of project-scoped
  plugins. Each project folder: flat `CLAUDE.md`/config leaves, type groups, and a **Worktrees**
  folder (one sub-folder per git worktree found under `<project>/.claude/worktrees/<name>/`). The
  Working Directory **Plugins** folder is built by `buildProjectPluginsFolder` from
  `PluginMetadataOptions.projectPlugins`/`projectClaudeDir` (contextValue `assetProjectPluginsRoot`;
  per-plugin `assetProjectPluginFolder<Enabled|Disabled><Project|Local>`), cross-referencing global
  installed metadata by full id for version + install dir; the container is emitted even when it is
  the only working-directory content. It also appears (empty, `(no plugins enabled)`) whenever the
  open folder has a `.claude` dir, so the Manage Plugins GUI is reachable before anything is enabled.

## Recognition rules
- Skill: `**/skills/<name>/SKILL.md`. Subagent: `**/agents/**/*.md`. Command: `**/commands/**/*.md`.
- Config: `settings.json` / `settings.local.json` / `keybindings.json` ONLY when the immediate
  parent dir is `.claude` (excludes `.vscode/settings.json` etc.).
- CLAUDE.md: only the global one, a CLAUDE.md inside a `.claude/`, at a scan root, or at a dir
  with a `.claude` sibling (project/worktree root). Deeply nested app `CLAUDE.md` is excluded.
- Memory: `MEMORY.md` and `*.md` under a `memory/` dir; always Global scope.

## Interactions / settings
- Click markdown asset -> `markdown.showPreview`; click config -> open in editor.
- Commands: refresh, addDirectory, removeDirectory, openFile, openPreview, revealInOS, deleteFile;
  createSkill/createAgent/createCommand (icon `$(add)`, inline `+` and right-click on the matching
  type-group folder -> prompt for a name, `createAsset` under the group's `createTargetDir`,
  re-scan, then open; creation under `~/.claude/plugins` is refused, mirroring the delete guard);
  plugin: updatePlugin, updateAllPlugins, updateMarketplacePlugins, uninstallPlugin, enablePlugin,
  disablePlugin (both scope-aware: append `--scope <project|local>` from the node when set),
  disablePluginForMe (forces `claude plugin disable <id> --scope local`),
  addMarketplace, removeMarketplace, refreshMarketplace, browseMarketplace
  (QuickPick of a source's not-yet-installed catalog plugins -> `claude plugin install`).
- Settings: `claudeAssets.directories`, `claudeAssets.followSymlinks`, `claudeAssets.excludeDirs`,
  `claudeAssets.maxDepth` (default 6, min 1; search depth for `.claude` dirs, unlimited once inside one),
  `claudeAssets.markdownOpenMode` (select default|code|preview|split; single-click open behavior for
  markdown assets, dispatched by the `claudeAssets.openMarkdown` command via `normalizeMarkdownOpenMode`).

## Build / run
- `npm install`, `npm run compile`, `npm test`.
- F5 (Run Extension) opens the Extension Development Host; the Claude Asset Manager container
  shows the Global and Working Directory sections.

## Out of scope (v1)
Creating asset types other than skill/subagent/command, renaming assets, structured MCP/hooks
editing, diff/git history, network update fetches (update check is local-timestamp only),
name-collision detection.
