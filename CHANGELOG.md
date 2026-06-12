# Changelog

All notable changes to the Claude Asset Manager extension are documented here. This project
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/). Older releases are listed at
[GitHub Releases](https://github.com/BradenTerry/ClaudeAssetManager/releases).

## [0.7.0] - 2026-06-12

### Added

- **Added Directories** section below Working Directory. Register directories outside your open
  workspace with the **+** button; they are saved to your user settings and persist across every
  workspace. Each registered directory always appears as a folder (even one with no Claude assets,
  marked `(no Claude assets)`) and can be removed by right-clicking it.
- **Drag and drop to copy assets** between Global, Working Directory, and Added Directories. Drag a
  single file or a whole folder (for example a full skill) onto a matching type folder, or onto a
  project / added-directory folder to route each item under its `.claude/<category>/`. Copies are
  type-constrained (a skill only lands in skills, an agent in agents, a command in commands) and you
  are prompted before overwriting an existing destination. Dragging copies; it never deletes the
  original.
- Per-section token toggle and the always-visible info legend on the Added Directories view.

### Changed

- Registered-directory assets are grouped under the new Added Directories section instead of being
  folded into Working Directory. Each section's token summary now counts only its own scope.
- Working Directory sub-project folders carry their root path so assets can be dropped onto them.

### Fixed

- Assets inside a registered directory's `.claude/` folder are now scoped as registered (they were
  misfiled under Working Directory), so an added directory's assets show in the right section.

## [0.6.1] - 2026-06-12

### Added

- Always-visible **info** button in each section's title bar that explains the token abbreviations
  (`~`, `tk`, `(a)`, `(d)`).
- Marketplace screenshots of the sidebar.

### Changed

- The token summary moved from the view message banner to a row at the top of the section, with the
  legend on hover.

## [0.6.0] - 2026-06-12

### Added

- Estimated token counts per asset, group folder, and a section summary row, split into
  always-loaded **(a)** and on-demand **(d)**. Toggle per section from the **tk** title-bar icon.
- Show/hide **worktrees** in the Working Directory section, hidden by default.

### Changed

- Token estimates are off by default.

### Fixed

- Worktree copies are excluded from the token summary so duplicates do not inflate the totals.
