'use strict';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[character]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const { connectionPresentation } = window.ConnectionPresentation;

let runtime = {
  connected: false,
  connecting: false,
  operationalState: 'disconnected',
  diagnostics: { running: false, checks: [] },
};
let settings = {};
let telemetry = { connCount: 0, apps: [], latencyMs: null };
let resources = [];
let pacUrl = '';
let sshConfig = '';
let shadowrocketModule = '';
let hpcSsh = { supported: false, installed: false, alias: 'hkustgz-hpc' };
let currentPage = 'overview';
const pageScrollPositions = new Map();
let settingsDirty = false;
let durationTimer = null;

function showAuthenticated(loggedIn) {
  $('login').hidden = loggedIn;
  $('appShell').hidden = !loggedIn;
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function relativeTime(timestamp) {
  if (!timestamp) return 'Not checked in this session';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function setPage(page) {
  const scroller = document.querySelector('.page-scroll');
  if (scroller) pageScrollPositions.set(currentPage, scroller.scrollTop);
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach((panel) => {
    const active = panel.dataset.pagePanel === page;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  $('pageTitle').textContent = {
    overview: 'Overview', access: 'Access', diagnostics: 'Diagnostics', settings: 'Settings',
  }[page];
  if (scroller) scroller.scrollTop = pageScrollPositions.get(page) || 0;
  if (page === 'diagnostics') loadLogs();
}

function connectionDetail() {
  if (runtime.operationalState === 'healthy') {
    const duration = runtime.connectedAt ? ` · Connected for ${formatDuration(Date.now() - runtime.connectedAt)}` : '';
    if (runtime.engineOwner === 'shared') return `Using the verified shared engine${duration}`;
    return `Last successful campus check ${relativeTime(runtime.lastHealthyAt)}${duration}`;
  }
  if (runtime.operationalState === 'checking') return 'The proxy is ready; campus reachability is being confirmed.';
  if (runtime.operationalState === 'degraded') return `Campus checks have failed ${runtime.probeFailures || 1} time(s). Run checks before restarting.`;
  if (runtime.operationalState === 'connecting') return 'Authenticating and establishing the campus data channels.';
  if (runtime.operationalState === 'reconnecting') return `Automatic recovery attempt ${runtime.retryAttempt || 1} is in progress.`;
  if (runtime.operationalState === 'blocked') return 'Resolve the issue below, then try again.';
  return 'No campus tunnel is running.';
}

function renderRuntime(next) {
  runtime = { ...runtime, ...next };
  const presentation = connectionPresentation(runtime.operationalState);
  $('globalState').className = `global-state ${presentation.tone}`;
  $('globalStateLabel').textContent = presentation.label;
  $('connectionBand').className = `connection-band ${presentation.tone}`;
  $('connectionTitle').textContent = presentation.title;
  $('connectionDetail').textContent = connectionDetail();
  $('connectionError').textContent = runtime.lastError || '';
  $('connectionButton').textContent = presentation.action;
  $('connectionButton').disabled = false;

  const running = runtime.connected || runtime.connecting;
  const tunnelVerified = runtime.operationalState === 'healthy';
  const tunnelStarting = runtime.connected || runtime.connecting;
  $('tunnelFact').innerHTML = `<i class="fact-dot ${tunnelVerified ? 'ok' : tunnelStarting ? 'warn' : ''}"></i>${tunnelVerified ? 'Verified' : runtime.connected ? 'Listener ready' : runtime.connecting ? 'Starting' : 'Stopped'}`;
  const pathHealthy = !!runtime.lastHealthyAt && !runtime.probeFailures;
  $('pathFact').innerHTML = `<i class="fact-dot ${pathHealthy ? 'ok' : runtime.probeFailures ? 'bad' : ''}"></i>${pathHealthy ? 'Healthy' : runtime.probeFailures ? 'Probe failed' : 'Not checked'}`;
  document.querySelectorAll('.restart-trigger').forEach((button) => { button.disabled = !running || runtime.connecting; });
  document.querySelectorAll('.diagnostics-trigger').forEach((button) => { button.disabled = !!runtime.diagnostics?.running; });
  renderDiagnostics(runtime.diagnostics);
  renderActivity();
  restartDurationTimer();
}

function renderTelemetry(next) {
  telemetry = { ...telemetry, ...next };
  const appCount = Array.isArray(telemetry.apps) ? telemetry.apps.length : 0;
  $('usageFact').textContent = `${telemetry.connCount || 0} connection${telemetry.connCount === 1 ? '' : 's'} · ${appCount} app${appCount === 1 ? '' : 's'}`;
  $('appsSection').hidden = !runtime.connected;
  const list = $('appsList');
  if (!telemetry.apps?.length) {
    list.innerHTML = '<div class="app-empty">No external applications are using the tunnel.</div>';
  } else {
    list.innerHTML = telemetry.apps.map((app) => `<div class="app-row"><i class="fact-dot ok"></i><strong>${esc(app.name)}</strong><span class="count">${Number(app.count) || 0} connection${app.count === 1 ? '' : 's'}</span></div>`).join('');
  }
}

function renderActivity() {
  const items = [];
  if (runtime.lastHealthyAt) items.push({ icon: 'check', title: 'Campus health check passed', detail: relativeTime(runtime.lastHealthyAt) });
  if (runtime.connectedAt) items.push({
    icon: 'link',
    title: runtime.engineOwner === 'shared'
      ? 'Attached to shared engine'
      : runtime.lastHealthyAt ? 'Tunnel connected' : 'Local proxy started',
    detail: formatDuration(Date.now() - runtime.connectedAt),
  });
  if (runtime.probeFailures) items.push({ icon: 'alert', title: 'Campus probe failed', detail: `${runtime.probeFailures} consecutive failure(s)` });
  if (!items.length) items.push({ icon: 'shield', title: 'No active campus session', detail: 'Connect when campus access is needed' });
  $('activityList').innerHTML = items.slice(0, 3).map((item) => `<div class="activity-row">${icon(item.icon)}<div><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span></div></div>`).join('');
}

function restartDurationTimer() {
  if (durationTimer) clearInterval(durationTimer);
  durationTimer = null;
  if (runtime.connectedAt) durationTimer = setInterval(renderActivity, 30000);
}

function renderResources() {
  const markup = resources.map((resource) => `<button class="resource-row" type="button" data-resource-url="${esc(resource.url)}" title="Open ${esc(resource.name)} in the default browser"><span><strong>${esc(resource.name)}</strong><span>${esc(resource.description)}</span></span>${icon('open')}</button>`).join('');
  $('overviewResources').innerHTML = markup;
  $('accessResources').innerHTML = markup;
}

function renderHpcSsh(next = {}) {
  hpcSsh = { ...hpcSsh, ...next };
  $('hpcSshRow').hidden = !hpcSsh.supported;
  if (!hpcSsh.supported) return;
  $('hpcSshStatus').textContent = hpcSsh.installed
    ? `ssh USER@${hpcSsh.alias}`
    : 'Automatic direct-on-campus routing';
  const button = $('hpcSshButton');
  button.querySelector('use').setAttribute('href', hpcSsh.installed ? '#i-x' : '#i-terminal');
  button.querySelector('span').textContent = hpcSsh.installed ? 'Remove' : 'Install';
  button.title = hpcSsh.installed ? 'Remove managed HPC SSH route' : 'Install managed HPC SSH route';
}

function renderDiagnostics(diagnostics = {}) {
  const running = !!diagnostics.running;
  const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
  $('diagnosticsMeta').textContent = running
    ? 'Running bounded checks...'
    : diagnostics.checkedAt
      ? `Checked ${relativeTime(diagnostics.checkedAt)} · ${Math.max(1, Math.round((diagnostics.durationMs || 0) / 1000))}s`
      : 'Not run in this session';
  if (running) {
    $('diagnosticsList').innerHTML = '<div class="diagnostic-row"><span class="diagnostic-icon pending"></span><div><strong>Checking campus access</strong><span>Testing the local process and approved network targets.</span></div><span class="diagnostic-status">In progress</span></div>';
    return;
  }
  if (!checks.length) {
    $('diagnosticsList').innerHTML = '<div class="diagnostic-row"><span class="diagnostic-icon unavailable">-</span><div><strong>No results yet</strong><span>Run checks to verify more than listener presence.</span></div><span class="diagnostic-status">Not run</span></div>';
    return;
  }
  $('diagnosticsList').innerHTML = checks.map((check) => {
    const iconName = check.status === 'pass' ? 'check' : check.status === 'fail' ? 'x' : 'alert';
    const status = check.status === 'pass' ? 'Passed' : check.status === 'fail' ? 'Failed' : 'Optional';
    return `<div class="diagnostic-row"><span class="diagnostic-icon ${esc(check.status)}">${icon(iconName)}</span><div><strong>${esc(check.label)}</strong><span>${esc(check.detail)}</span></div><span class="diagnostic-status">${status}</span></div>`;
  }).join('');
}

function populateSettings() {
  $('settingsUsername').value = settings.username || '';
  $('settingsPassword').value = '';
  $('startAtLogin').checked = !!settings.startAtLogin;
  $('autoConnect').checked = settings.autoConnect !== false;
  $('autoReconnect').checked = settings.autoReconnect !== false;
  $('maxAttempts').value = settings.maxAttempts ?? 3;
  $('maxAttempts').disabled = settings.autoReconnect === false;
  $('closeAction').value = ['ask', 'minimize', 'quit'].includes(settings.closeAction) ? settings.closeAction : 'minimize';
  $('settingsPort').value = settings.port || 1080;
  $('routeDomains').value = (settings.routeDomains || []).join('\n');
  $('routeIpv4Cidrs').value = (settings.routeIpv4Cidrs || []).join('\n');
  $('vpnDnsServers').value = (settings.vpnDnsServers || []).join('\n');
  settingsDirty = false;
}

async function refreshState({ preserveSettings = false } = {}) {
  const next = await window.api.getState();
  settings = next.settings || {};
  resources = Array.isArray(next.campusResources) ? next.campusResources : [];
  pacUrl = next.pacUrl || '';
  telemetry = next.telemetry || telemetry;
  renderRuntime(next);
  renderTelemetry(telemetry);
  renderResources();
  $('socksFact').textContent = `127.0.0.1:${Number(settings.port) || 1080}`;
  $('socksEndpoint').textContent = `127.0.0.1:${Number(settings.port) || 1080}`;
  $('pacEndpoint').textContent = pacUrl || '-';
  $('sidebarAccount').textContent = settings.username || '-';
  $('sidebarVersion').textContent = next.version ? `Version ${next.version}` : '-';
  renderHpcSsh(next.hpcSsh);
  $('loginUsername').value = settings.username || '';
  if (!preserveSettings || !settingsDirty) populateSettings();
  showAuthenticated(next.loggedIn);
  return next;
}

async function runDiagnostics() {
  if (runtime.diagnostics?.running) return;
  renderRuntime({ diagnostics: { ...runtime.diagnostics, running: true } });
  setPage('diagnostics');
  try {
    const result = await window.api.runDiagnostics();
    renderRuntime({ diagnostics: result });
  } catch (error) {
    $('diagnosticsMeta').textContent = error?.message || 'Checks failed to run.';
  }
}

async function restartTunnel() {
  document.querySelectorAll('.restart-trigger').forEach((button) => { button.disabled = true; });
  $('recoveryMessage').textContent = 'Restarting the tunnel...';
  try {
    const result = await window.api.reconnect();
    $('recoveryMessage').textContent = result?.ok ? 'Restart requested.' : 'The tunnel could not be restarted.';
  } finally {
    setTimeout(() => { $('recoveryMessage').textContent = ''; }, 2200);
  }
}

async function openResource(button) {
  const message = currentPage === 'access' ? $('accessOpenMessage') : $('overviewOpenMessage');
  message.classList.remove('error');
  message.textContent = '';
  button.disabled = true;
  try {
    const result = await window.api.openExternalCampusResource(button.dataset.resourceUrl);
    if (!result?.ok) {
      message.classList.add('error');
      message.textContent = result?.error || 'The default browser could not be opened.';
    }
  } finally {
    button.disabled = false;
    setTimeout(() => { message.textContent = ''; message.classList.remove('error'); }, 2600);
  }
}

async function loadLogs() {
  const logs = await window.api.getLogs();
  $('logs').textContent = logs?.trim() || 'No logs yet. Connect to create the sanitized engine log.';
  $('logs').scrollTop = $('logs').scrollHeight;
}

async function saveSettings(event) {
  event.preventDefault();
  const port = Number($('settingsPort').value);
  const maxAttempts = Number($('maxAttempts').value);
  if (!Number.isInteger(port) || port < 1025 || port > 65535) return showSettingsMessage('SOCKS port must be an integer from 1025 to 65535.', true);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) return showSettingsMessage('Retry limit must be an integer from 0 to 10.', true);
  const payload = {
    username: $('settingsUsername').value.trim(),
    port,
    startAtLogin: $('startAtLogin').checked,
    autoConnect: $('autoConnect').checked,
    autoReconnect: $('autoReconnect').checked,
    maxAttempts,
    closeAction: $('closeAction').value,
    routeDomains: $('routeDomains').value,
    routeIpv4Cidrs: $('routeIpv4Cidrs').value,
    vpnDnsServers: $('vpnDnsServers').value,
  };
  if ($('settingsPassword').value) payload.password = $('settingsPassword').value;
  $('saveSettings').disabled = true;
  try {
    const result = await window.api.save(payload);
    if (!result?.ok) return showSettingsMessage(result?.error || 'Settings could not be saved.', true);
    settings = result.settings || settings;
    settingsDirty = false;
    $('settingsPassword').value = '';
    await refreshState();
    showSettingsMessage(result.warning || (result.reconnected ? 'Settings saved and tunnel reconnected.' : 'Settings saved.'), !!result.warning);
  } finally { $('saveSettings').disabled = false; }
}

function showSettingsMessage(message, isError = false) {
  $('settingsMessage').textContent = message;
  $('settingsMessage').classList.toggle('error', isError);
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
document.querySelectorAll('[data-go-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.goPage)));

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  if (!username || !password) { $('loginError').textContent = 'Enter both the campus account and password.'; return; }
  $('loginButton').disabled = true;
  try {
    const saved = await window.api.save({ username, password });
    if (!saved?.ok) { $('loginError').textContent = saved?.error || 'The account could not be saved.'; return; }
    $('loginPassword').value = '';
    $('loginError').textContent = '';
    await refreshState();
    setPage('overview');
    await window.api.connect();
  } finally { $('loginButton').disabled = false; }
});

$('connectionButton').addEventListener('click', async () => {
  if (runtime.connected || runtime.connecting) await window.api.disconnect();
  else await window.api.connect();
});
document.querySelectorAll('.diagnostics-trigger').forEach((button) => button.addEventListener('click', runDiagnostics));
document.querySelectorAll('.restart-trigger').forEach((button) => button.addEventListener('click', restartTunnel));
document.addEventListener('click', (event) => {
  const resource = event.target.closest('[data-resource-url]');
  if (resource) openResource(resource);
});

document.querySelectorAll('.copy-trigger').forEach((button) => button.addEventListener('click', async () => {
  let value = '';
  if (button.dataset.copy === 'socks') value = `127.0.0.1:${Number(settings.port) || 1080}`;
  if (button.dataset.copy === 'pac') value = pacUrl;
  if (button.dataset.copy === 'ssh') value = sshConfig || await window.api.sshConfig();
  if (button.dataset.copy === 'shadowrocket') {
    value = shadowrocketModule || await window.api.shadowrocketModule();
    shadowrocketModule = value;
  }
  if (!value) return;
  await window.api.copy(value);
  $('copyMessage').classList.remove('error');
  $('copyMessage').textContent = 'Copied.';
  setTimeout(() => { $('copyMessage').textContent = ''; }, 1200);
}));

$('hpcSshButton').addEventListener('click', async () => {
  const button = $('hpcSshButton');
  button.disabled = true;
  try {
    const result = hpcSsh.installed
      ? await window.api.removeHpcSsh()
      : await window.api.installHpcSsh();
    renderHpcSsh(result?.state);
    $('copyMessage').classList.toggle('error', !result?.ok);
    $('copyMessage').textContent = result?.ok
      ? (hpcSsh.installed ? `Ready: ssh USER@${hpcSsh.alias}` : 'HPC SSH route removed.')
      : result?.error || 'HPC SSH route could not be changed.';
  } finally {
    button.disabled = false;
  }
});

$('refreshLogs').addEventListener('click', loadLogs);
$('copyLogs').addEventListener('click', async () => { await window.api.copy($('logs').textContent); });
$('revealLog').addEventListener('click', () => window.api.openLog());
$('settingsForm').addEventListener('submit', saveSettings);
$('discardSettings').addEventListener('click', () => { populateSettings(); showSettingsMessage('Changes discarded.'); });
$('autoReconnect').addEventListener('change', () => { $('maxAttempts').disabled = !$('autoReconnect').checked; settingsDirty = true; });
for (const id of ['settingsUsername', 'settingsPassword', 'startAtLogin', 'autoConnect', 'maxAttempts', 'closeAction', 'settingsPort', 'routeDomains', 'routeIpv4Cidrs', 'vpnDnsServers']) {
  $(id).addEventListener('input', () => { settingsDirty = true; });
  $(id).addEventListener('change', () => { settingsDirty = true; });
}

$('forgetAccount').addEventListener('click', async () => {
  const dialog = $('confirmDialog');
  dialog.showModal();
  const confirmed = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  if (!confirmed) return;
  await window.api.logout();
  $('loginPassword').value = '';
  await refreshState();
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState({ preserveSettings: true }); });
window.api.onStatus(renderRuntime);
window.api.onTelemetry(renderTelemetry);

(async () => {
  await refreshState();
  sshConfig = await window.api.sshConfig();
  $('sshEndpoint').textContent = sshConfig.split('\n').pop() || sshConfig;
})();
