# Claude Assets (VSCode extension)

A VSCode extension that discovers every Claude Code asset a user can create across their
machine -- skills, subagents, slash commands, memory/CLAUDE.md, and JSON config -- and shows
them in a sidebar tree with scope labels and name-collision detection. Viewing and editing
happen by opening the file in the editor natively; the extension has no editor of its own.

(This folder previously held a native Avalonia desktop app for the same purpose; it was
replaced by this extension because editing is better left to the editor and VSCode's tree +
file-watching + markdown preview come for free.)

## Stack
- TypeScript (strict), compiled with tsc to CommonJS in `out/`. `engines.vscode` ^1.90.0.
- `yaml` for frontmatter parsing; `JSON.parse` for config.
- Mocha + Node assert + ts-node, temp-directory (mkdtemp) fixtures. No testcontainers.

## Architecture
- `src/core/` -- ZERO `vscode` import; all discovery/parse/scope/collision logic, so it is
  unit-testable without the extension host. Home dir, registered dirs, and workspace dirs are
  injected so tests never touch the real `~/.claude`.
  - `types.ts` -- AssetType, AssetScope, ClaudeAsset (incl. `tools?: string[]`), Collision, ScanOptions.
  - `frontmatter.ts` -- parseFrontmatter(text) -> { data, body } via `yaml`.
  - `assetFactory.ts` -- file + root -> ClaudeAsset; `parseToolsList` handles YAML-list and
    comma-separated `tools`/`allowed-tools`.
  - `scanRoots.ts` -- buildScanRoots(homeDir, registeredDirs, workspaceDirs) with scope tags.
  - `scanner.ts` -- walks roots, follows symlinks (fs.realpathSync), cycle guard on a
    visited-real-path set, prunes noise dirs; `deriveScope` classifies by location.
  - `collisions.ts` -- detectCollisions(assets) grouped by (type, name).
- `src/tree/` -- `nodeDescriptors.ts` is a PURE `buildTreeNodes(assets, collisions)` returning
  node data (no vscode import, so it is unit-tested headless); `nodes.ts` + `assetTreeProvider.ts`
  map nodes to `vscode.TreeItem` and implement TreeDataProvider.
- `src/services/` -- `settings.ts` (read/write `claudeAssets.directories`), `watcher.ts`
  (debounced fs.watch over scan roots -> refresh).
- `src/extension.ts` -- activate(): registers the tree, the six commands, settings, watcher.
- `media/claude-assets.svg` -- Activity Bar icon.

## Scope classification (deriveScope)
Global = under `~/.claude` excluding plugins; Plugin = under `~/.claude/plugins`;
Project = path contains a `.claude/` segment (or a project-root CLAUDE.md) under a scanned
dir; Registered = a loose asset under a registered dir with no `.claude/` segment.
Global and Plugin are matched first so they are never reclassified.

## Discovery
Sources: global `~/.claude/`, `~/.claude/plugins/`, `~/.claude/projects/*/memory/`,
registered dirs from the `claudeAssets.directories` setting (recursive), and open workspace
folders. Symlinks are followed (load-bearing: `~/.claude/skills`, `agents`, `CLAUDE.md` are
typically symlinks into a dotfiles repo). Noise dirs pruned: node_modules, .git, bin, obj,
dist, target, .venv, venv, .idea, .vs. Missing files/dirs are never errors.

## Recognition rules
- Skill: `**/skills/<name>/SKILL.md` (name = enclosing dir); frontmatter name/description/allowed-tools.
- Subagent: `**/.claude/agents/**/*.md`; frontmatter name/description/tools/model.
- Command: `**/.claude/commands/**/*.md`; namespaced name from subpath.
- ClaudeMd: `CLAUDE.md` (global symlink, project root, nested).
- Memory: `~/.claude/projects/*/memory/MEMORY.md` + sibling per-fact `*.md`.
- Config: `settings.json`, `settings.local.json`, `keybindings.json` (type=Config).

## Contributes (package.json)
- View container `claude-assets` (Activity Bar) + tree view `claudeAssets.tree`.
- Commands: `claudeAssets.refresh`, `.addDirectory`, `.removeDirectory`, `.openFile`,
  `.openPreview`, `.revealInOS` (openFile -> showTextDocument, openPreview -> markdown.showPreview,
  revealInOS -> revealFileInOS).
- Settings: `claudeAssets.directories`, `claudeAssets.followSymlinks`, `claudeAssets.excludeDirs`.

## Tests
39 Mocha tests, headless (no Electron host): scanner discovery/scope/symlink/cycle/noise-prune,
collision detection, frontmatter + tools parsing, scope classification (all four scopes incl.
Project-via-registered-`.claude` and Registered-loose), and the pure `buildTreeNodes`
(groups per type, collisions group, asset node carries filePath/contextValue).

## Build / run
- `npm install` (needs network), `npm run compile`, `npm test`.
- Manual smoke: open the folder in VSCode and press F5 (Extension Development Host); the
  Claude Assets view should list assets from `~/.claude`. Not automatable here.

## Out of scope (v1)
In-extension editing / JSON validation, creating or deleting assets, plugin management,
MCP/hooks structured views, diff/git/history, webview UI, a full Electron-host test suite.
