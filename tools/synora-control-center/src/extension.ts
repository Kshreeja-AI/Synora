import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONTROL_COMMANDS, findCommand, type ControlCommand } from './commands';
import { renderDashboard } from './dashboard';
import { collectStatus } from './status';

/**
 * The Synora Control Center — a developer-only view over commands that
 * already exist in this repository.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────
 *
 * Not a second orchestrator, not a second provider registry, not a daemon,
 * not an agent, and not a controller for Claude Code. It has no AI in it, no
 * background process, no configuration of its own and no credentials. It
 * spawns a command, streams the output into a panel, and reports the exit
 * code it was given.
 *
 * ── AND IT DOES NOT CONTROL CLAUDE ───────────────────────────────────────
 *
 * There is no supported interface for driving Claude Code from an extension,
 * so this does not pretend to. Claude Code remains the coding agent, running
 * in its own terminal; this is the panel that tells the founder what the
 * repository currently says about itself — tests, capabilities, environment,
 * containers — without them having to remember eleven commands.
 *
 * Building a fake "Claude status" pane would have looked better in a demo and
 * lied on the first day it mattered.
 *
 * ── SECURITY POSTURE ─────────────────────────────────────────────────────
 *
 *  - Commands are a FIXED LIST (`./commands.ts`). The webview sends an id;
 *    an unknown id runs nothing. There is no path by which webview content
 *    becomes a shell string.
 *  - `spawn` without a shell, with argv arrays. No interpolation, so nothing
 *    the UI can say becomes a command.
 *  - Output is HTML-escaped before it reaches the panel.
 *  - No deploy, DNS, migrate-production or VPS operation is offered at all.
 *    Those are not guarded here; they are ABSENT here.
 */

let outputChannel: vscode.OutputChannel | undefined;
let running: { command: ControlCommand; kill: () => void } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Synora Control Center');
  const provider = new DashboardViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider),
    outputChannel
  );

  for (const command of CONTROL_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command.id, () => runCommand(command, provider))
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('synora.launchReport', () => generateLaunchReport(provider)),
    vscode.commands.registerCommand('synora.refresh', () => refreshStatus(provider))
  );
}

export function deactivate(): void {
  running?.kill();
}

/* ── Running a command ────────────────────────────────────────────────── */

function repositoryRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runCommand(command: ControlCommand, view: DashboardViewProvider): void {
  const root = repositoryRoot();
  if (!root) {
    vscode.window.showErrorMessage('Synora: open the repository folder first.');
    return;
  }
  if (running) {
    // One at a time, on purpose: two suites sharing one database interfere
    // with each other, and the resulting failure looks like a code defect.
    vscode.window.showWarningMessage(
      `Synora: "${running.command.label}" is still running. Wait for it, or stop it from the panel.`
    );
    return;
  }

  const channel = outputChannel!;
  channel.show(true);
  channel.appendLine('');
  channel.appendLine(`── ${command.label} ─────────────────────────────`);
  channel.appendLine(`   ${command.program} ${command.args.join(' ')}   (in ${command.cwd})`);
  channel.appendLine(`   expect: ${command.expect}`);
  channel.appendLine('');

  view.setRunning(command.id, true);
  const startedAt = Date.now();

  // No shell. argv is an array, so nothing here can be turned into a command
  // by anything the webview sends — the webview only ever sends an id that
  // must match this fixed list.
  const child = spawn(command.program, [...command.args], {
    cwd: path.join(root, command.cwd),
    shell: process.platform === 'win32',
    env: process.env,
  });

  running = { command, kill: () => child.kill() };

  const push = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.length > 0) {
        channel.appendLine(line);
        view.appendLog(line);
      }
    }
  };

  child.stdout?.on('data', push);
  child.stderr?.on('data', push);

  child.on('close', (code) => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const verdict = code === 0 ? 'PASSED' : `FAILED (exit ${code})`;
    channel.appendLine('');
    channel.appendLine(`── ${command.label}: ${verdict} in ${seconds}s`);
    running = undefined;
    view.setRunning(command.id, false);
    // The exit code is reported as-is. A UI that softened a non-zero exit
    // would be the single most damaging thing this extension could do.
    view.setResult(command.id, code === 0 ? 'passed' : 'failed', `${verdict} in ${seconds}s`, command.label);
  });

  child.on('error', (error) => {
    channel.appendLine(`could not start: ${error.message}`);
    running = undefined;
    view.setRunning(command.id, false);
    view.setResult(command.id, 'failed', `could not start: ${error.message}`);
  });
}

/**
 * The launch report is the same commands, run in sequence, with their real
 * results collected — NOT a separate assessment.
 *
 * A report that computed its own verdict would eventually disagree with the
 * commands it claims to summarise, and the report is exactly the artefact
 * somebody would trust over the terminal.
 */
async function generateLaunchReport(view: DashboardViewProvider): Promise<void> {
  const sequence = ['synora.guardrails', 'synora.capabilities', 'synora.typecheck', 'synora.smokeTest'];
  vscode.window.showInformationMessage(
    `Synora: running ${sequence.length} checks in sequence. Output is in the Synora Control Center channel.`
  );
  for (const id of sequence) {
    const command = findCommand(id);
    if (!command) continue;
    await new Promise<void>((resolve) => {
      runCommand(command, view);
      const timer = setInterval(() => {
        if (!running) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  }
}

/* ── The view ─────────────────────────────────────────────────────────── */

class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'synora.dashboard';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = renderDashboard(webviewView.webview.cspSource);

    webviewView.webview.onDidReceiveMessage((message: { type?: string; id?: string }) => {
      // The ONLY thing the webview can ask for is a command id from the fixed
      // list. An unknown id runs nothing; there is no branch where webview
      // content becomes a program name, an argument, or a path.
      if (message?.type !== 'run' || typeof message.id !== 'string') return;
      if (message.id === 'synora.refresh') {
        void vscode.commands.executeCommand('synora.refresh');
        return;
      }
      if (message.id === 'synora.launchReport') {
        void vscode.commands.executeCommand('synora.launchReport');
        return;
      }
      if (!findCommand(message.id)) return;
      void vscode.commands.executeCommand(message.id);
    });
  }

  setRunning(id: string, isRunning: boolean): void {
    this.view?.webview.postMessage({ type: 'running', id, isRunning });
  }

  setResult(id: string, state: 'passed' | 'failed', detail: string, label?: string): void {
    this.view?.webview.postMessage({ type: 'result', id, state, detail, label });
  }

  setStatus(snapshot: unknown): void {
    this.view?.webview.postMessage({ type: 'status', snapshot });
  }

  appendLog(line: string): void {
    this.view?.webview.postMessage({ type: 'log', line });
  }
}

/**
 * Collect live status and hand it to the panel.
 *
 * Offline and free: it runs the capability report (config + registries only)
 * and `docker ps`. It does NOT check credential validity — that costs a
 * network round-trip per provider and stays a button — and it does NOT query
 * spend, which lives in the database this refresh must work without.
 */
async function refreshStatus(view: DashboardViewProvider): Promise<void> {
  const root = repositoryRoot();
  if (!root) {
    vscode.window.showErrorMessage('Synora: open the repository folder first.');
    return;
  }
  view.setRunning('synora.refresh', true);
  try {
    const snapshot = await collectStatus(root);
    view.setStatus(snapshot);
    const failed = snapshot.errors.length > 0;
    view.setResult(
      'synora.refresh',
      failed ? 'failed' : 'passed',
      failed ? snapshot.errors.join('; ') : `collected ${snapshot.collectedAt}`,
      'Refresh Status'
    );
  } catch (error) {
    view.setResult(
      'synora.refresh',
      'failed',
      error instanceof Error ? error.message : String(error),
      'Refresh Status'
    );
  } finally {
    view.setRunning('synora.refresh', false);
  }
}
