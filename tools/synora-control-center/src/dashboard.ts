import { CONTROL_COMMANDS } from './commands';

/**
 * The dashboard's markup.
 *
 * ── EVERY STATE IS MEASURED OR LABELLED UNMEASURED ───────────────────────
 *
 * There are no hardcoded ticks. Capability, provider, cost and container rows
 * render as "not checked" until `Refresh Status` has actually run a command,
 * and the check rows stay blank until their button has been pressed. A panel
 * that opened showing nine green capabilities would be the most convincing
 * lie in the repository: it would look exactly like a verified system while
 * being a picture.
 *
 * ── CSP ──────────────────────────────────────────────────────────────────
 *
 * Script and style are inline with a nonce; no remote origin is permitted.
 * Every value that arrives from a command is inserted with `textContent`,
 * never `innerHTML` — command output can contain anything, including markup
 * from a test fixture, and a provider name is not trusted input either.
 */
export function renderDashboard(cspSource: string): string {
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 62)
    )
  ).join('');

  const buttons = CONTROL_COMMANDS.map(
    (c) => `
      <button class="cmd" data-id="${c.id}" title="${escapeHtml(c.purpose)}">
        <span class="cmd-label">${escapeHtml(c.label)}</span>
        <span class="cmd-meta"><span class="badge" id="badge-${c.id}">not run</span>${escapeHtml(c.expect)}</span>
      </button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 10px 12px 26px; margin: 0; }
  h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .3px; }
  .sub { opacity: .6; margin: 0 0 12px; font-size: 11px; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .9px; opacity: .55; margin: 16px 0 6px; font-weight: 600; }
  .tree { font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px; line-height: 1.5; opacity: .75; white-space: pre; margin: 0 0 6px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; align-items: baseline; }
  .row .name { opacity: .9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .val { font-size: 10px; letter-spacing: .3px; opacity: .5; white-space: nowrap; }
  .val.ok       { color: var(--vscode-testing-iconPassed, #3fb950); opacity: 1; }
  .val.bad      { color: var(--vscode-testing-iconFailed, #f85149); opacity: 1; }
  .val.warn     { color: var(--vscode-charts-yellow, #d29922); opacity: 1; }
  .val.muted    { opacity: .4; }
  button.cmd { display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; margin: 3px 0; padding: 6px 9px; cursor: pointer;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.14)); color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid transparent; border-radius: 3px; font-size: 12px; }
  button.cmd:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.24)); }
  button.cmd:disabled { opacity: .5; cursor: default; }
  .cmd-meta { display: flex; align-items: center; gap: 8px; font-size: 10px; opacity: .55; }
  .badge { font-size: 9px; letter-spacing: .4px; text-transform: uppercase; }
  .badge.passed { color: var(--vscode-testing-iconPassed, #3fb950); opacity: 1; }
  .badge.failed { color: var(--vscode-testing-iconFailed, #f85149); opacity: 1; }
  .badge.running { color: var(--vscode-charts-yellow, #d29922); opacity: 1; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-top: 6px; }
  #log { font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px; white-space: pre-wrap; word-break: break-word;
    max-height: 240px; overflow-y: auto; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.09));
    padding: 8px; border-radius: 3px; margin-top: 6px; line-height: 1.45; }
  .note { font-size: 10.5px; opacity: .5; line-height: 1.5; margin-top: 6px;
    border-left: 2px solid var(--vscode-panel-border, rgba(128,128,128,.3)); padding-left: 8px; }
</style>
</head>
<body>
  <h1>SYNORA</h1>
  <p class="sub">Development control plane — local only</p>

<pre class="tree">        INTELLIGENCE ORCHESTRATOR
                   │
    ┌──────────────┼──────────────┐
 CLASSICAL      SYNORA        QUANTUM
    AI            AI         RESEARCH
    └──────────────┼──────────────┘
             CAPABILITIES
                   │
               PROVIDERS</pre>

  <button class="cmd primary" data-id="synora.refresh">
    <span class="cmd-label">Refresh Status</span>
    <span class="cmd-meta"><span class="badge" id="badge-synora.refresh">not run</span>~15s, offline</span>
  </button>

  <h2>System status</h2>
  <div id="system"><div class="row"><span class="name">containers</span><span class="val muted">not checked</span></div></div>

  <h2>Capabilities</h2>
  <div id="capabilities"><div class="row"><span class="name">all</span><span class="val muted">not checked</span></div></div>

  <h2>Providers</h2>
  <div id="providers"><div class="row"><span class="name">all</span><span class="val muted">not checked</span></div></div>
  <p class="note">Configured means a credential is present. It does not mean the credential works — press <b>Check Providers</b> for that.</p>

  <h2>Cost control</h2>
  <div id="cost"><div class="row"><span class="name">limits</span><span class="val muted">not checked</span></div></div>

  <h2>Security</h2>
  <div id="security"><div class="row"><span class="name">guardrails / audit / modes</span><span class="val muted">not checked</span></div></div>

  <h2>Launch status</h2>
  <div id="launch"></div>

  <h2>Checks</h2>
  ${buttons}
  <button class="cmd primary" data-id="synora.launchReport">
    <span class="cmd-label">Generate Launch Report</span>
    <span class="cmd-meta"><span class="badge" id="badge-synora.launchReport">not run</span>sequence</span>
  </button>

  <h2>Output</h2>
  <div id="log">No command has run yet.</div>

  <p class="note">
    Runs repository commands and shows their real output. It does not deploy,
    change DNS, touch the VPS, edit credentials, or drive Claude Code — Claude
    Code remains the coding agent in its own terminal.
  </p>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  let cleared = false;

  // textContent everywhere. Command output and provider names are untrusted.
  function row(name, value, cls) {
    const r = document.createElement('div');
    r.className = 'row';
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    const v = document.createElement('span');
    v.className = 'val ' + (cls || 'muted');
    v.textContent = value;
    r.appendChild(n); r.appendChild(v);
    return r;
  }

  function fill(id, rows) {
    const el = document.getElementById(id);
    el.textContent = '';
    if (rows.length === 0) { el.appendChild(row('—', 'nothing reported', 'muted')); return; }
    for (const r of rows) el.appendChild(r);
  }

  const GOOD = ['ENABLED', 'VERIFIED'];
  const BAD = ['BLOCKED', 'NOT_IMPLEMENTED'];

  document.querySelectorAll('button.cmd').forEach((button) => {
    button.addEventListener('click', () => vscode.postMessage({ type: 'run', id: button.dataset.id }));
  });

  window.addEventListener('message', (event) => {
    const m = event.data;

    if (m.type === 'log') {
      if (!cleared) { log.textContent = ''; cleared = true; }
      log.textContent += m.line + '\\n';
      log.scrollTop = log.scrollHeight;
      return;
    }

    if (m.type === 'status') {
      const s = m.snapshot;

      fill('system', (s.containers || []).length
        ? s.containers.map((c) => row(c.name, c.status, /healthy|Up/.test(c.status) ? 'ok' : 'warn'))
        : [row('docker', s.containers === null ? 'not reachable' : 'no containers running', 'bad')]);

      fill('capabilities', (s.capabilities || []).map((c) =>
        row(c.capability, c.state, GOOD.includes(c.state) ? 'ok' : BAD.includes(c.state) ? 'bad' : 'warn')));

      const provs = [];
      for (const c of s.capabilities || []) {
        for (const p of c.providers || []) {
          provs.push(row(p.id + '  ·  ' + c.capability, p.configured ? 'configured' : 'no credential',
            p.configured ? 'ok' : 'muted'));
        }
      }
      fill('providers', provs);

      const L = s.limits || {};
      fill('cost', [
        row('daily cost limit', L.globalMaxCostPerDayCents === null || L.globalMaxCostPerDayCents === undefined
          ? 'UNSET' : L.globalMaxCostPerDayCents + ' cents',
          L.globalMaxCostPerDayCents ? 'ok' : 'bad'),
        row('daily token limit', L.globalMaxTokensPerDay ? String(L.globalMaxTokensPerDay) : 'unset',
          L.globalMaxTokensPerDay ? 'ok' : 'muted'),
        row('per-user daily limit', L.userMaxCostPerDayCents ? L.userMaxCostPerDayCents + ' cents' : 'unset',
          L.userMaxCostPerDayCents ? 'ok' : 'muted'),
        // Deliberately not fabricated: spend lives in the database, and this
        // refresh must work without one.
        row('current usage', 'not queried — lives in the database', 'muted'),
      ]);

      fill('security', [
        row('stage', String(L.stage || 'unknown'), 'muted'),
        row('mock mode', L.mockMode ? 'ACTIVE' : 'off', L.mockMode ? 'bad' : 'ok'),
        row('offline mode', L.offlineMode ? 'ACTIVE' : 'off', L.offlineMode ? 'bad' : 'ok'),
        row('AI_PROVIDER selection', String(L.providerSelection || 'unknown'),
          L.providerSelection === 'valid' || L.providerSelection === 'unset' ? 'ok' : 'bad'),
        row('guardrails / secret scan / audit', 'press the buttons below', 'muted'),
      ]);

      if ((s.errors || []).length) {
        for (const e of s.errors) document.getElementById('system').appendChild(row('error', e, 'bad'));
      }
      return;
    }

    const badge = document.getElementById('badge-' + m.id);
    if (!badge) return;
    if (m.type === 'running') {
      if (m.isRunning) { badge.textContent = 'running'; badge.className = 'badge running'; }
      document.querySelectorAll('button.cmd').forEach((b) => { b.disabled = m.isRunning; });
    }
    if (m.type === 'result') {
      badge.textContent = m.state;
      badge.className = 'badge ' + m.state;
      badge.title = m.detail;
      const launch = document.getElementById('launch');
      const existing = document.getElementById('launch-' + m.id);
      if (existing) existing.remove();
      const r = row(m.label || m.id, m.state, m.state === 'passed' ? 'ok' : 'bad');
      r.id = 'launch-' + m.id;
      launch.appendChild(r);
    }
  });
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
