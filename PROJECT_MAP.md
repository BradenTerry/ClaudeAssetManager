# Claude Asset Manager

A native VSCode extension that discovers and browses every Claude Code asset on a machine
(skills, subagents, slash commands, memory/CLAUDE.md, and `.claude` JSON config) in two
collapsible sidebar sections: **Global** and a **Working Directory** section titled after the
open folder (e.g. `Projects (WD)`). Markdown opens in the rendered preview on click; config
opens in the editor. The extension is read-and-open only (it does not create assets).

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
  - `assetFactory.ts` -- `recognizeAssetType` + `buildAsset`; parses `tools`/`allowed-tools`.
  - `containerDerivations.ts` -- `derivePluginName`, `deriveProjectInfo` ({project, worktree}),
    `deriveMemoryProject`, `isRootLevelAsset`.
  - `pluginMetadata.ts` -- `readInstalledPlugins`, `readCatalogLastUpdated`, `isOutdated`.
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
- `src/extension.ts` -- `activate`: two views, six commands, watcher; titles the Working
  Directory view after the open folder + ` (WD)`; reads plugin metadata each scan (no network).

## Tree structure
- **Global** section: flat `CLAUDE.md` + config leaves, then type groups (Skills, Subagents,
  Commands), then a **Projects** folder holding per-project memory (`~/.claude/projects/*/memory`),
  then a **Plugins** folder (installed plugins only, each showing version and an "update
  available" indicator when the catalog timestamp is newer).
- **Working Directory** section: the scan root's own `.claude` assets rendered flat at the top,
  then one folder per sub-project (sorted alpha). Each project folder: flat `CLAUDE.md`/config
  leaves, type groups, and a **Worktrees** folder (one sub-folder per git worktree found under
  `<project>/.claude/worktrees/<name>/`).

## Recognition rules
- Skill: `**/skills/<name>/SKILL.md`. Subagent: `**/agents/**/*.md`. Command: `**/commands/**/*.md`.
- Config: `settings.json` / `settings.local.json` / `keybindings.json` ONLY when the immediate
  parent dir is `.claude` (excludes `.vscode/settings.json` etc.).
- CLAUDE.md: only the global one, a CLAUDE.md inside a `.claude/`, at a scan root, or at a dir
  with a `.claude` sibling (project/worktree root). Deeply nested app `CLAUDE.md` is excluded.
- Memory: `MEMORY.md` and `*.md` under a `memory/` dir; always Global scope.

## Interactions / settings
- Click markdown asset -> `markdown.showPreview`; click config -> open in editor.
- Commands: refresh, addDirectory, removeDirectory, openFile, openPreview, revealInOS.
- Settings: `claudeAssets.directories`, `claudeAssets.followSymlinks`, `claudeAssets.excludeDirs`.

## Build / run
- `npm install`, `npm run compile`, `npm test`.
- F5 (Run Extension) opens the Extension Development Host; the Claude Asset Manager container
  shows the Global and Working Directory sections.

## Out of scope (v1)
Creating/deleting assets, structured MCP/hooks editing, plugin install/update actions, diff/git
history, network update fetches (update check is local-timestamp only), name-collision detection.
