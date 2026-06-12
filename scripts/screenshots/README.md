# MARKETPLACE.md screenshots

`render.mjs` regenerates the sidebar screenshots in `media/screenshot-*.png` by rendering a
faithful HTML reproduction of the VS Code sidebar (real `@vscode/codicons` font + Dark Modern
theme colors, plus the extension's custom title-bar icons) in headless Chromium. It uses fake
data only and touches no real workspace.

The token-estimate view is off by default, so the overview and worktree shots show the clean
default tree; only `screenshot-tokens.png` turns estimates on to demo the feature.

## Regenerate

```sh
npm i --no-save playwright @vscode/codicons
npx playwright install chromium
node scripts/screenshots/render.mjs
```

The Playwright and codicons packages are intentionally not project dependencies (installed with
`--no-save`); only the generated PNGs are committed.
