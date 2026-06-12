// Generates the MARKETPLACE.md screenshots by rendering a faithful reproduction of the
// VS Code sidebar (real codicon font + Dark Modern theme tokens) in headless Chromium
// and screenshotting each panel. Fake data only -- no real workspace is touched.
//
// Regenerate:
//   npm i --no-save playwright @vscode/codicons && npx playwright install chromium
//   node scripts/screenshots/render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const distDir = path.join(repo, 'node_modules/@vscode/codicons/dist');
const mediaDir = path.join(repo, 'media');

// Inline the codicon font + glyph rules as a data URI. A file:// <link> from a
// setContent (about:blank origin) document is blocked by Chromium, so embed instead.
const ttfB64 = fs.readFileSync(path.join(distDir, 'codicon.ttf')).toString('base64');
const codiconCssInline = fs.readFileSync(path.join(distDir, 'codicon.css'), 'utf8')
  .replace(/src:\s*url\([^)]*\)\s*format\([^)]*\);/,
    `src: url(data:font/ttf;base64,${ttfB64}) format("truetype");`);

// VS Code Dark Modern palette.
const C = {
  bg: '#181818', headerFg: '#bbbbbb', fg: '#cccccc', dim: '#9d9d9d',
  icon: '#c5c5c5', guide: '#404040', border: '#2b2b2b',
  tipBg: '#202020', tipBorder: '#454545'
};

// Inline title-bar icons that the extension ships as custom SVGs.
const tkIcon = `<span style="font:700 11px/1 -apple-system,'Segoe UI',sans-serif;letter-spacing:-.5px;color:${C.icon}">tk</span>`;
const treeIcon = `<svg width="15" height="15" viewBox="0 0 16 16" style="vertical-align:middle">
  <g fill="${C.icon}"><circle cx="5.5" cy="6" r="2.7"/><circle cx="10.5" cy="6" r="2.7"/><circle cx="8" cy="3.7" r="3"/><rect x="7.3" y="6.5" width="1.4" height="6"/></g>
  <line x1="2.5" y1="13.3" x2="13.5" y2="13.3" stroke="${C.icon}" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ci = (name, color = C.icon, size = 16) => `<i class="codicon codicon-${name}" style="font-size:${size}px;color:${color}"></i>`;

// One tree row. level = indent depth; twisty = 'down'|'right'|null; icon = html; label/desc strings.
function row({ level = 0, twisty = null, icon = '', label = '', desc = '', strong = false }) {
  const guides = Array.from({ length: level }, () =>
    `<span style="display:inline-block;width:16px;border-left:1px solid ${C.guide};height:22px;vertical-align:top"></span>`).join('');
  const tw = twisty
    ? ci(`chevron-${twisty}`, C.icon, 16)
    : `<span style="display:inline-block;width:16px"></span>`;
  const ic = icon ? `<span style="display:inline-block;width:16px;text-align:center;margin-right:5px">${icon}</span>` : '';
  const d = desc ? `<span style="color:${C.dim};font-size:12px;margin-left:8px">${desc}</span>` : '';
  return `<div style="display:flex;align-items:center;height:22px;padding-left:4px;white-space:nowrap">
    ${guides}<span style="display:inline-flex;align-items:center;width:16px;justify-content:center">${tw}</span>${ic}<span style="color:${C.fg};font-weight:${strong ? 600 : 400}">${label}</span>${d}</div>`;
}

function header(title, icons) {
  const acts = icons.map(i => `<span style="display:inline-flex;align-items:center;width:22px;height:22px;justify-content:center">${i}</span>`).join('');
  return `<div style="display:flex;align-items:center;height:24px;padding:0 4px 0 6px;border-bottom:1px solid ${C.border}">
    ${ci('chevron-down', C.headerFg, 16)}
    <span style="flex:1;color:${C.headerFg};font:700 11px/1 -apple-system,'Segoe UI',sans-serif;letter-spacing:.5px;margin-left:2px">${title}</span>
    ${acts}</div>`;
}

const folder = ci('folder');
// Files carry no extension-set icon, so VS Code renders them with the user's file icon
// theme (Seti by default): markdown is a solid blue down-arrow, JSON a yellow braces glyph.
const md = `<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle">
  <path fill="#519aba" d="M6.4 2H9.6V8H12L8 12.6 4 8H6.4Z"/></svg>`;
const json = ci('json', '#cbcb41');

// Title-bar icon sets.
const addIcon = ci('add');
const globalIcons = [ci('info'), tkIcon, ci('refresh')];
const wdIcons = [ci('info'), tkIcon, treeIcon, ci('refresh')];
const addedIcons = [ci('info'), tkIcon, addIcon, ci('refresh')];

function panel(innerHtml, width = 300) {
  return `<div class="panel" style="width:${width}px;background:${C.bg};border-radius:8px;overflow:hidden;
    padding-bottom:5px;box-shadow:0 8px 30px rgba(0,0,0,.45);font:13px/1 -apple-system,'Segoe UI',system-ui,sans-serif">${innerHtml}</div>`;
}

function page(bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <style>${codiconCssInline}</style>
  <style>*{box-sizing:border-box}body{margin:0;padding:24px;display:inline-block}
  .codicon{vertical-align:middle}</style></head>
  <body>${bodyHtml}</body></html>`;
}

// ---- Image content ---------------------------------------------------------
// Token estimates are OFF by default (an opt-in, debug-style view), so the hero and
// worktree shots show the clean default tree. Only the dedicated tokens shot turns them on.

const globalRowsClean =
  header('GLOBAL', globalIcons) +
  row({ twisty: 'right', icon: md, label: 'CLAUDE.md' }) +
  row({ twisty: 'right', icon: json, label: 'settings.json' }) +
  row({ twisty: 'right', icon: folder, label: 'skills' }) +
  row({ twisty: 'right', icon: folder, label: 'agents' }) +
  row({ twisty: 'right', icon: folder, label: 'commands' }) +
  row({ twisty: 'right', icon: folder, label: 'workflows' }) +
  row({ twisty: 'right', icon: folder, label: 'projects' }) +
  row({ twisty: 'right', icon: folder, label: 'plugins', desc: '3/4 enabled' });

const wdRowsClean =
  row({ twisty: 'right', icon: md, label: 'CLAUDE.md' }) +
  row({ twisty: 'right', icon: json, label: 'settings.json' }) +
  row({ twisty: 'down', icon: folder, label: 'skills' }) +
  row({ level: 1, twisty: 'right', icon: folder, label: 'test' }) +
  row({ twisty: 'down', icon: folder, label: 'agents' }) +
  row({ level: 1, icon: md, label: 'ops-engineer.md' }) +
  row({ twisty: 'right', icon: folder, label: 'commands' }) +
  row({ twisty: 'right', icon: folder, label: 'workflows' });

// 1. Overview (default state, token estimates off): all three sections.
const addedRowsClean =
  row({ twisty: 'right', icon: folder, label: 'shared-prompts' }) +
  row({ twisty: 'right', icon: folder, label: 'team-standards' });
const overview = panel(
  globalRowsClean + `<div style="height:6px"></div>` +
  header('WORKOUTS (WD)', wdIcons) + wdRowsClean + `<div style="height:6px"></div>` +
  header('ADDED DIRECTORIES', addedIcons) + addedRowsClean
);

// 2. Tokens close-up: token estimates turned ON, with a hover tooltip over the summary row.
const wdRowsTokens =
  row({ label: '~512 tk (a) · ~1.5k tk (d)' }) +
  row({ twisty: 'right', icon: md, label: 'CLAUDE.md', desc: '~394 tk (a)' }) +
  row({ twisty: 'right', icon: json, label: 'settings.json' }) +
  row({ twisty: 'down', icon: folder, label: 'skills', desc: '~13 tk (a) · ~4 tk (d)' }) +
  row({ level: 1, twisty: 'right', icon: folder, label: 'test' }) +
  row({ twisty: 'down', icon: folder, label: 'agents', desc: '~105 tk (a) · ~956 tk (d)' }) +
  row({ level: 1, icon: md, label: 'ops-engineer.md', desc: '~105 tk (a) · ~956 tk (d)' }) +
  row({ twisty: 'right', icon: folder, label: 'commands', desc: '~80 tk (d)' }) +
  row({ twisty: 'right', icon: folder, label: 'workflows' });
const tooltip = `<div style="position:absolute;left:34px;top:58px;width:300px;background:${C.tipBg};
  border:1px solid ${C.tipBorder};border-radius:5px;padding:8px 10px;color:${C.fg};
  font:12px/1.55 -apple-system,'Segoe UI',system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.5)">
  ~&nbsp;&nbsp;a rough estimate, not the exact tokenizer count.<br>
  tk&nbsp;&nbsp;tokens.<br>
  (a) always loaded: counted into Claude's context every turn.<br>
  (d) on demand: loaded only when that asset is used.</div>`;
const tokens = `<div style="position:relative;display:inline-block">${panel(header('WORKOUTS (WD)', wdIcons) + wdRowsTokens, 320)}${tooltip}</div>`;

// 3. Worktrees: WD with the worktrees folder expanded (token estimates off).
const wdWorktrees = header('WORKOUTS (WD)', wdIcons) +
  row({ twisty: 'right', icon: md, label: 'CLAUDE.md' }) +
  row({ twisty: 'down', icon: folder, label: 'agents' }) +
  row({ level: 1, icon: md, label: 'ops-engineer.md' }) +
  row({ twisty: 'down', icon: folder, label: 'worktrees' }) +
  row({ level: 1, twisty: 'down', icon: folder, label: 'agent-ac745f10' }) +
  row({ level: 2, twisty: 'down', icon: folder, label: 'agents' }) +
  row({ level: 3, icon: md, label: 'ops-engineer.md' });
const worktrees = panel(wdWorktrees, 320);

// ---- Render ----------------------------------------------------------------

const shots = [
  { name: 'screenshot-overview.png', html: overview },
  { name: 'screenshot-tokens.png', html: tokens },
  { name: 'screenshot-worktrees.png', html: worktrees }
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const pg = await ctx.newPage();
for (const s of shots) {
  await pg.setContent(page(s.html), { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  const el = await pg.$('body > div');
  await el.screenshot({ path: path.join(mediaDir, s.name), omitBackground: true });
  console.log('wrote', s.name);
}
await browser.close();
