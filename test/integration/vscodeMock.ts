/**
 * A faithful-enough fake of the `vscode` module so the real extension can be
 * activated and its command handlers driven inside plain mocha -- no Electron.
 *
 * Importing this module installs a Module._load hook so that any
 * `require('vscode')` (from src/extension.ts and everything it pulls in) resolves
 * to the singleton `vscodeMock` exported here. Tests drive behaviour through the
 * exported `harness`: queue dialog responses before invoking a command, then read
 * back the recorded messages / external opens / executed built-ins.
 */
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Harness: mutable control + recording surface shared with the tests.
// ---------------------------------------------------------------------------

export interface RecordedMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
  detail?: string;
}

interface Harness {
  messages: RecordedMessage[];
  /** Queued return values for showWarningMessage (FIFO). Default: undefined (cancel). */
  warningResponses: Array<string | undefined>;
  /** Queued return values for the modal showInformationMessage (FIFO). */
  infoResponses: Array<string | undefined>;
  /** Queued return values for showInputBox (FIFO). */
  inputResponses: Array<string | undefined>;
  /** Queued return values for showQuickPick (FIFO). */
  quickPickResponses: Array<unknown>;
  /** Queued return values for showOpenDialog (FIFO). */
  openDialogResponses: Array<unknown>;
  /** executeCommand calls for ids NOT registered by the extension (built-ins). */
  executed: Array<{ command: string; args: unknown[] }>;
  /** URIs passed to env.openExternal (as strings). */
  openedExternal: string[];
  /** Flat config store keyed by "section.key", e.g. "claudeAssets.directories". */
  config: Record<string, unknown>;
  workspaceFolders: Array<{ uri: { fsPath: string }; name: string }> | undefined;
  workspaceName: string | undefined;
  /** Tree views created via window.createTreeView, keyed by view id. `provider` is the
   *  registered TreeDataProvider, so tests can inspect rendered rows (e.g. the summary). */
  treeViews: Record<string, { title: string; message?: string; provider?: { getChildren(el?: unknown): unknown } }>;
  /** Registered onDidSaveTextDocument handlers; fire via fireDidSave(). */
  saveHandlers: Array<(doc: { uri: { fsPath: string } }) => void>;
  /** Number of leading workspace.fs.delete calls that should throw before one succeeds. */
  fsDeleteFailuresRemaining: number;
  /** errno used for the simulated delete failures (e.g. 'EBUSY', 'EPERM'). */
  fsDeleteErrorCode: string;
  /** How many times workspace.fs.delete was invoked. */
  fsDeleteCalls: number;
  reset(): void;
}

export const harness: Harness = {
  messages: [],
  warningResponses: [],
  infoResponses: [],
  inputResponses: [],
  quickPickResponses: [],
  openDialogResponses: [],
  executed: [],
  openedExternal: [],
  config: {},
  workspaceFolders: [],
  workspaceName: undefined,
  treeViews: {},
  saveHandlers: [],
  fsDeleteFailuresRemaining: 0,
  fsDeleteErrorCode: 'EBUSY',
  fsDeleteCalls: 0,
  reset(): void {
    this.messages = [];
    this.warningResponses = [];
    this.infoResponses = [];
    this.inputResponses = [];
    this.quickPickResponses = [];
    this.openDialogResponses = [];
    this.executed = [];
    this.openedExternal = [];
    this.config = {};
    this.workspaceFolders = [];
    this.workspaceName = undefined;
    this.treeViews = {};
    this.saveHandlers = [];
    this.fsDeleteFailuresRemaining = 0;
    this.fsDeleteErrorCode = 'EBUSY';
    this.fsDeleteCalls = 0;
  }
};

/** Convenience accessor: the last recorded message, or undefined. */
export function lastMessage(): RecordedMessage | undefined {
  return harness.messages[harness.messages.length - 1];
}

/** Simulate VSCode firing onDidSaveTextDocument for a file path. */
export function fireDidSave(fsPath: string): void {
  for (const cb of harness.saveHandlers) {
    cb({ uri: { fsPath } });
  }
}

// ---------------------------------------------------------------------------
// Internal: command registry populated by registerCommand during activate().
// ---------------------------------------------------------------------------

const commandRegistry = new Map<string, (...args: unknown[]) => unknown>();

function recordMessage(
  level: RecordedMessage['level'],
  args: unknown[],
  responseQueue: Array<string | undefined>
): Promise<string | undefined> {
  const text = String(args[0] ?? '');
  let detail: string | undefined;
  let rest = args.slice(1);
  // An options object ({ modal, detail }) may precede the action items.
  if (rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0])) {
    detail = (rest[0] as { detail?: string }).detail;
    rest = rest.slice(1);
  }
  harness.messages.push({ level, text, detail });
  const resp = responseQueue.length > 0 ? responseQueue.shift() : undefined;
  return Promise.resolve(resp);
}

// ---------------------------------------------------------------------------
// Minimal class/enum stand-ins used by the tree node + provider modules.
// ---------------------------------------------------------------------------

class Uri {
  private constructor(public fsPath: string, public scheme: string) {}
  static file(p: string): Uri {
    return new Uri(p, 'file');
  }
  static parse(s: string): Uri {
    return new Uri(s, 'parsed');
  }
  toString(): string {
    return this.fsPath;
  }
}

class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: () => { /* no-op */ } };
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners = [];
  }
}

class TreeItem {
  label: unknown;
  collapsibleState: unknown;
  resourceUri?: unknown;
  iconPath?: unknown;
  description?: unknown;
  tooltip?: unknown;
  contextValue?: unknown;
  command?: unknown;
  constructor(label: unknown, collapsibleState?: unknown) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(public id: string, public color?: unknown) {}
}
class ThemeColor {
  constructor(public id: string) {}
}
class MarkdownString {
  isTrusted = false;
  constructor(public value: string = '') {}
  appendMarkdown(v: string): this {
    this.value += v;
    return this;
  }
}

function disposable(): { dispose(): void } {
  return { dispose: () => { /* no-op */ } };
}

// ---------------------------------------------------------------------------
// The mock module object.
// ---------------------------------------------------------------------------

export const vscodeMock = {
  Uri,
  EventEmitter,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  MarkdownString,
  Disposable: class {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  ViewColumn: { One: 1, Two: 2, Active: -1, Beside: -2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },

  window: {
    showInformationMessage: (...args: unknown[]) => recordMessage('info', args, harness.infoResponses),
    showWarningMessage: (...args: unknown[]) => recordMessage('warn', args, harness.warningResponses),
    showErrorMessage: (...args: unknown[]) => recordMessage('error', args, []),
    showInputBox: () =>
      Promise.resolve(harness.inputResponses.length > 0 ? harness.inputResponses.shift() : undefined),
    showQuickPick: () =>
      Promise.resolve(harness.quickPickResponses.length > 0 ? harness.quickPickResponses.shift() : undefined),
    showOpenDialog: () =>
      Promise.resolve(harness.openDialogResponses.length > 0 ? harness.openDialogResponses.shift() : undefined),
    showTextDocument: () => Promise.resolve({}),
    withProgress: (_opts: unknown, task: (p: unknown) => unknown) =>
      Promise.resolve(task({ report: () => { /* no-op */ } })),
    createTreeView: (id: string, opts?: { treeDataProvider?: { getChildren(el?: unknown): unknown } }) => {
      const view = {
        title: '',
        message: undefined as string | undefined,
        description: '',
        provider: opts?.treeDataProvider,
        visible: true,
        reveal: () => Promise.resolve(),
        onDidChangeVisibility: () => disposable(),
        onDidChangeSelection: () => disposable(),
        onDidExpandElement: () => disposable(),
        onDidCollapseElement: () => disposable(),
        dispose: () => { /* no-op */ }
      };
      harness.treeViews[id] = view;
      return view;
    },
    createWebviewPanel: () => ({
      webview: { html: '', onDidReceiveMessage: () => disposable(), postMessage: () => Promise.resolve(true), asWebviewUri: (u: unknown) => u, cspSource: '' },
      onDidDispose: () => disposable(),
      reveal: () => { /* no-op */ },
      dispose: () => { /* no-op */ }
    })
  },

  commands: {
    registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
      commandRegistry.set(id, cb);
      return disposable();
    },
    executeCommand: (id: string, ...args: unknown[]) => {
      const cb = commandRegistry.get(id);
      if (cb) {
        return Promise.resolve(cb(...args));
      }
      harness.executed.push({ command: id, args });
      return Promise.resolve(undefined);
    }
  },

  workspace: {
    get workspaceFolders() {
      return harness.workspaceFolders;
    },
    get name() {
      return harness.workspaceName;
    },
    getConfiguration: (section: string) => ({
      get: (key: string, def?: unknown) => {
        const full = `${section}.${key}`;
        return full in harness.config ? harness.config[full] : def;
      },
      update: (key: string, value: unknown) => {
        harness.config[`${section}.${key}`] = value;
        return Promise.resolve();
      }
    }),
    fs: {
      delete: (uri: { fsPath: string }) => {
        harness.fsDeleteCalls++;
        // Simulate a Windows file lock that clears after a few attempts.
        if (harness.fsDeleteFailuresRemaining > 0) {
          harness.fsDeleteFailuresRemaining--;
          const err = new Error(`${harness.fsDeleteErrorCode}: simulated lock, unlink '${uri.fsPath}'`);
          (err as Error & { code?: string }).code = harness.fsDeleteErrorCode;
          return Promise.reject(err);
        }
        fs.rmSync(uri.fsPath, { recursive: true, force: true });
        return Promise.resolve();
      }
    },
    onDidChangeConfiguration: () => disposable(),
    onDidChangeWorkspaceFolders: () => disposable(),
    onDidSaveTextDocument: (cb: (doc: { uri: { fsPath: string } }) => void) => {
      harness.saveHandlers.push(cb);
      return disposable();
    }
  },

  env: {
    openExternal: (uri: { toString(): string }) => {
      harness.openedExternal.push(uri.toString());
      return Promise.resolve(true);
    }
  }
};

// ---------------------------------------------------------------------------
// Install the require('vscode') hook exactly once.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeModule = require('module') as { _load: (...a: unknown[]) => unknown };
const originalLoad = NodeModule._load;
NodeModule._load = function (this: unknown, ...args: unknown[]): unknown {
  if (args[0] === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.apply(this, args);
};
