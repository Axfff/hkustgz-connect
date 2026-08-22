'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, Menu, clipboard, safeStorage, session,
  Tray, nativeImage, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { loadSettings: readSettings, saveSettings: writeSettings } = require('./lib/settings-store');
const { applySettingsPatch } = require('./lib/settings-update');
const { PasswordSession } = require('./lib/credential-store');
const { classifyEngineOutput, engineLifecycleSignal } = require('./lib/engine-output');
const { buildPac } = require('./lib/pac');
const {
  loadNetworkPolicy, networkPoliciesEqual, normalizeNetworkPolicy, saveNetworkPolicy,
} = require('./lib/network-policy');
const { CampusBrowser, normalizeCampusUrl } = require('./lib/campus-browser');
const { loadCampusResources } = require('./lib/campus-resources');
const { ensureOwnerOnly } = require('./lib/private-file');
const { appendLog, readLogTail, resetLog } = require('./lib/secure-log');
const { loadTrayImage } = require('./lib/tray-icon');
const { describePortConflict, isCampusEngineExecutable } = require('./lib/port-conflict');
const { probeSocksConnect } = require('./lib/socks-health');
const { diagnosticsAreHealthy, probeTcpEndpoint } = require('./lib/diagnostics');
const { deriveOperationalState } = require('./lib/presentation-state');
const {
  PROBE_TIMEOUT_MS, TELEMETRY_TICK_MS, shouldProbe, shouldRecover,
} = require('./lib/tunnel-health');
const { CampusCredentialVault } = require('./lib/campus-credential-vault');

// ---------- single instance (avoid the app fighting its own session) ----------
// `app.quit()` does not stop the rest of this module from running, so return
// before a second instance touches the shared settings, credential, and log
// files that the first instance owns.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setName('HKUST(GZ) Connect');

// ---------- paths & state ----------
const DATA = app.getPath('userData');
const SETTINGS = path.join(DATA, 'settings.json');
const CRED = path.join(DATA, 'cred.bin');
const LOG = path.join(DATA, 'engine.log');
const PAC_FILE = path.join(DATA, 'routing.pac');
const CAMPUS_CREDENTIALS = path.join(DATA, 'campus-credentials.json');
const SHARED_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config');
const POLICY = path.join(SHARED_CONFIG_HOME, 'hkustgz-connect', 'policy.json');
const GATEWAY_HOST = 'remote.hkust-gz.edu.cn';
const passwordSession = new PasswordSession({
  file: CRED,
  safeStorage,
  platform: process.platform,
});

for (const privateFile of [SETTINGS, CRED, LOG, PAC_FILE, CAMPUS_CREDENTIALS, POLICY]) {
  ensureOwnerOnly(privateFile);
}

let win = null;
let tray = null;
let campusBrowser = null;
let isQuitting = false;
let closePromptOpen = false;
let engine = null;
let externalEnginePid = null;
let connectInFlight = null;
let reconnectInFlight = null;
let userDisconnected = false;
let attempts = 0;
const MAX_ATTEMPTS = 3;
let connectedAt = null;
let gatewayIp = null;
let telemetryTimer = null;
let teleBusy = false;
let tunnelProbeFailures = 0;
let tunnelRecoveryInFlight = false;
let engineReconnecting = false;
let probeInFlight = false;
let diagnosticsInFlight = null;
let lastHealthyAt = null;
let lastDiagnostics = { running: false, checkedAt: null, durationMs: null, checks: [] };
let lastTele = { connCount: 0, apps: [], latencyMs: null };
let state = { connected: false, connecting: false, clientIp: null, lastError: null, pacUrl: '' };

// ---------- settings & credentials ----------
function loadSettings() {
  return readSettings(SETTINGS);
}
function saveSettings(settings) { return writeSettings(SETTINGS, settings); }
async function savePassword(pw) {
  return passwordSession.save(pw);
}
async function loadPassword() {
  return passwordSession.load();
}
function hasPassword() { return passwordSession.hasStored(); }
function socksPort() { return Number(loadSettings().port) || 1080; }
function loadPolicy() {
  try { return loadNetworkPolicy(POLICY); }
  catch { return normalizeNetworkPolicy({}); }
}

// ---------- engine ----------
function enginePath() {
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const ext = plat === 'windows' ? '.exe' : '';
  const named = `ec-engine-${plat}-${arch}${ext}`;
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, 'engine');
  const candidates = [
    path.join(dir, named),
    path.join(dir, plat === 'windows' ? 'ec-engine.exe' : 'ec-engine'),
    path.join(__dirname, '..', 'engine', 'target', 'release', plat === 'windows' ? 'ec-engine.exe' : 'ec-engine'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function engineConfigPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'engine', 'hkustgz.json')]
    : [path.join(__dirname, '..', 'config', 'hkustgz.json')];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function publicRuntimeState() {
  const operationalState = deriveOperationalState({
    connected: state.connected,
    connecting: state.connecting,
    recovering: tunnelRecoveryInFlight || engineReconnecting,
    attempts,
    probeFailures: tunnelProbeFailures,
    lastHealthyAt,
    lastError: state.lastError,
  });
  return {
    ...state,
    engineOwner: engine ? 'app' : externalEnginePid ? 'shared' : null,
    operationalState,
    connectedAt,
    lastHealthyAt,
    probeFailures: tunnelProbeFailures,
    retryAttempt: attempts,
    diagnostics: lastDiagnostics,
  };
}

function emit() {
  state.pacUrl = pacUrl();
  if (win && !win.isDestroyed()) win.webContents.send('status', publicRuntimeState());
  updateTray();
}

async function connect(isRetry) {
  if (engine || externalEnginePid) return;
  if (connectInFlight) return connectInFlight;
  connectInFlight = connectOnce(isRetry);
  try { return await connectInFlight; }
  finally { connectInFlight = null; }
}

async function connectOnce(isRetry) {
  if (engine || externalEnginePid) return;
  if (!isRetry) { attempts = 0; userDisconnected = false; }
  const s = loadSettings();
  state.connecting = true; state.connected = false; state.lastError = null; state.clientIp = null;
  lastHealthyAt = null;
  lastDiagnostics = { running: false, checkedAt: null, durationMs: null, checks: [] };
  emit();
  gatewayIp = GATEWAY_HOST;
  if (userDisconnected) { state.connecting = false; emit(); return; }
  const ownerPid = await listeningPid(s.port);
  if (ownerPid) {
    const executable = (await run('ps', ['-p', String(ownerPid), '-o', 'comm='], 1000)).trim();
    const campusHealthy = await probeSocksConnect({
      proxyPort: s.port,
      targetHost: 'www.hkust-gz.edu.cn',
      targetPort: 443,
      timeoutMs: 5000,
    });
    if (isCampusEngineExecutable(executable) && campusHealthy) {
      externalEnginePid = ownerPid;
      state.connecting = false;
      state.connected = true;
      state.lastError = null;
      connectedAt = Date.now();
      lastHealthyAt = connectedAt;
      attempts = 0;
      startTelemetry();
      emit();
      return;
    }
    state.connecting = false;
    state.lastError = describePortConflict({
      port: s.port,
      pid: ownerPid,
      executable,
      campusHealthy,
    });
    emit();
    return;
  }
  const pw = await loadPassword();
  if (!s.username || !pw) { state.connecting = false; state.lastError = '请先填写账号和密码'; emit(); return; }
  const bin = enginePath();
  if (!fs.existsSync(bin)) { state.connecting = false; state.lastError = '引擎缺失:' + bin; emit(); return; }
  const engineConfig = engineConfigPath();
  if (!fs.existsSync(engineConfig)) { state.connecting = false; state.lastError = '引擎配置缺失:' + engineConfig; emit(); return; }
  try { resetLog(LOG); } catch {}
  const engineArguments = [
    '--config', engineConfig,
    '--credentials-stdin',
    '--socks-bind', `127.0.0.1:${Number(s.port)}`,
  ];
  if (fs.existsSync(POLICY)) engineArguments.push('--local-policy', POLICY);
  engine = spawn(bin, engineArguments, { stdio: ['pipe', 'pipe', 'pipe'] });
  externalEnginePid = null;
  // An engine that dies before reading stdin (missing library, wrong
  // architecture) makes this write emit EPIPE. Without a listener that would
  // become an uncaught exception and take the whole application down, so the
  // failure is left to the 'exit' handler instead.
  engine.stdin.on('error', () => {});
  engine.stdin.end(`${s.username}\n${pw}\n`);
  let diagnosticTail = '';
  const onData = (d) => {
    const t = d.toString();
    try { appendLog(LOG, t); } catch {}
    diagnosticTail = (diagnosticTail + t).slice(-512);
    const lifecycle = engineLifecycleSignal(diagnosticTail);
    if (lifecycle === 'recovering' && !engineReconnecting) {
      engineReconnecting = true;
      state.connected = false;
      state.connecting = true;
      state.lastError = 'Campus data path disconnected; the engine is reconnecting.';
      connectedAt = null;
      lastHealthyAt = null;
      stopTelemetry();
      emit();
    } else if (lifecycle === 'ready' && (!state.connected || engineReconnecting)) {
      engineReconnecting = false;
      state.connecting = false;
      state.connected = true;
      state.lastError = null;
      attempts = 0;
      connectedAt = Date.now();
      lastHealthyAt = null;
      startTelemetry();
      emit();
    }
    if (/Client IP assigned/.test(diagnosticTail)) { state.clientIp = '已分配'; emit(); }
    const classifiedError = classifyEngineOutput(diagnosticTail, s.port);
    if (classifiedError) state.lastError = classifiedError;
  };
  engine.stdout.on('data', onData);
  engine.stderr.on('data', onData);
  engine.on('error', (err) => { state.connecting = false; state.lastError = '无法启动引擎:' + err.message; emit(); });
  engine.on('exit', (code) => {
    const wasConnected = state.connected;
    const uptime = connectedAt ? (Date.now() - connectedAt) : 0;
    engine = null;
    externalEnginePid = null;
    engineReconnecting = false;
    state.connected = false; state.clientIp = null; connectedAt = null;
    lastHealthyAt = null;
    lastDiagnostics = { running: false, checkedAt: null, durationMs: null, checks: [] };
    stopTelemetry();
    const authErr = /账号或密码|鉴权/.test(state.lastError || '');
    const cfg = loadSettings();
    const autoOn = cfg.autoReconnect !== false;
    const maxA = Number.isInteger(cfg.maxAttempts) ? cfg.maxAttempts : MAX_ATTEMPTS;
    // user-initiated stop or bad credentials → never auto-reconnect
    if (userDisconnected || authErr) { state.connecting = false; emit(); return; }
    // A session that stayed up a while and THEN dropped (gateway kick / engine gvisor
    // panic / network blip / idle timeout) gets a FRESH retry budget so it always
    // recovers — this is the fix for "无缘无故掉线". A connection that died almost
    // immediately keeps counting against maxA so a hard failure can't hammer the gateway.
    if (wasConnected && uptime > 20000) attempts = 0;
    if (autoOn && attempts < maxA) {
      attempts++;
      const delay = Math.min(2000 * attempts, 15000); // linear backoff, capped at 15s
      state.connecting = true;
      state.lastError = wasConnected ? '连接中断,正在自动重连…' : null;
      emit();
      setTimeout(() => connect(true), delay);
      return;
    }
    state.connecting = false;
    if (!state.lastError) state.lastError = wasConnected
      ? '连接已断开,自动重连多次失败,请手动重连或查看日志'
      : (code ? '连接失败,请重试或查看日志' : null);
    emit();
  });
}
function disconnect() {
  userDisconnected = true;
  engineReconnecting = false;
  connectedAt = null;
  lastHealthyAt = null;
  lastDiagnostics = { running: false, checkedAt: null, durationMs: null, checks: [] };
  stopTelemetry();
  if (engine) {
    engine.kill();
    return;
  }
  externalEnginePid = null;
  state.connected = false;
  state.connecting = false;
  state.clientIp = null;
  emit();
}

function waitForConnectionIdle(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (!connectInFlight && !engine && !externalEnginePid) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 50);
    };
    poll();
  });
}

function waitForConnected(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (state.connected && lastHealthyAt) return resolve(true);
      if (userDisconnected || (!state.connecting && !engine && !externalEnginePid && state.lastError)) {
        return resolve(false);
      }
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function reconnect() {
  if (reconnectInFlight) return reconnectInFlight;
  reconnectInFlight = (async () => {
    disconnect();
    if (!await waitForConnectionIdle()) {
      state.connecting = false;
      state.lastError = '引擎未能停止，请退出程序后重试';
      emit();
      return { ok: false };
    }
    await connect();
    return { ok: true };
  })();
  try { return await reconnectInFlight; }
  finally { reconnectInFlight = null; }
}

// ---------- telemetry: latency + which apps use the SOCKS tunnel ----------
const net = require('net');
function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    require('child_process').execFile(cmd, args, { timeout, windowsHide: true }, (e, so) => resolve(so || ''));
  });
}
async function listeningPid(port) {
  if (process.platform === 'win32') {
    const script = `(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`;
    const output = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      3000,
    );
    const pid = Number(output.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }
  const output = await run(
    'lsof',
    ['-nP', '-a', '-iTCP@127.0.0.1:' + Number(port), '-sTCP:LISTEN', '-Fp'],
    1500,
  );
  const match = output.match(/^p(\d+)$/m);
  return match ? Number(match[1]) : null;
}
function tcpPing(host, port) {
  return new Promise((resolve) => {
    if (!host) return resolve(null);
    const t0 = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok ? Number(process.hrtime.bigint() - t0) / 1e6 : null); };
    sock.setTimeout(3000);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}
function friendly(n) {
  if (/Chrome|chrome/.test(n)) return 'Google Chrome';
  if (/Code Helper/.test(n)) return 'VS Code';
  if (/Microsoft Edge|msedge/.test(n)) return 'Microsoft Edge';
  if (/Lark|Feishu|飞书/.test(n)) return 'Lark/飞书';
  if (/firefox/i.test(n)) return 'Firefox';
  if (n === 'ssh' || n === 'sshd') return 'SSH';
  if (/^(curl|wget|nc|node)$/.test(n)) return n;
  return n;
}
const processNames = new Map();
const MAX_TRACKED_PROCESS_NAMES = 256;
async function listTunnelApps(proxyPorts, enginePid, appPid) {
  const ports = new Set(proxyPorts.filter(
    (port) => Number.isInteger(port) && port >= 1 && port <= 65535
  ));
  if (!ports.size) return { connCount: 0, apps: [] };
  try {
    if (process.platform === 'win32') {
      const portFilter = [...ports].map((port) => `$_.RemotePort -eq ${port}`).join(' -or ');
      const ps = `$r=Get-NetTCPConnection -State Established -RemoteAddress 127.0.0.1 -EA SilentlyContinue|?{${portFilter}}|Group-Object OwningProcess|%{$p=Get-Process -Id $_.Name -EA SilentlyContinue;[pscustomobject]@{Pid=[int]$_.Name;Name=$p.ProcessName;Count=$_.Count}};$r|ConvertTo-Json -Compress`;
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 4000);
      let arr = []; try { const j = JSON.parse(out); arr = Array.isArray(j) ? j : [j]; } catch {}
      const apps = arr.filter((a) => a && a.Pid !== enginePid && a.Pid !== appPid)
        .map((a) => ({ pid: a.Pid, name: friendly(a.Name || String(a.Pid)), count: a.Count }));
      return { connCount: apps.reduce((s, a) => s + (a.count || 0), 0), apps };
    }
    const out = await run('lsof', ['-nP', '-iTCP@127.0.0.1', '-sTCP:ESTABLISHED', '-F', 'pcn'], 1500);
    const tuples = new Map(); const cmd = new Map(); let pid = null;
    for (const ln of out.split('\n')) {
      const k = ln[0], v = ln.slice(1);
      if (k === 'p') pid = Number(v);
      else if (k === 'c') cmd.set(pid, v);
      else if (k === 'n') {
        const m = v.match(/->127\.0\.0\.1:(\d+)$/);
        if (m && ports.has(Number(m[1])) && pid !== enginePid && pid !== appPid) tuples.set(v, pid);
      }
    }
    const perPid = new Map();
    for (const p of tuples.values()) perPid.set(p, (perPid.get(p) || 0) + 1);
    const apps = [];
    for (const [p, count] of perPid) {
      // lsof truncates the command name, so the full one comes from ps. A pid
      // keeps the same name for its whole life, so resolve each one once instead
      // of spawning ps for every process on every telemetry tick.
      let name = processNames.get(p);
      if (name === undefined) {
        const full = (await run('ps', ['-p', String(p), '-o', 'comm='], 800)).trim();
        name = full ? full.split('/').pop() : (cmd.get(p) || String(p));
        if (processNames.size >= MAX_TRACKED_PROCESS_NAMES) processNames.clear();
        processNames.set(p, name);
      }
      apps.push({ pid: p, name: friendly(name), count });
    }
    apps.sort((a, b) => b.count - a.count);
    return { connCount: tuples.size, apps };
  } catch { return { connCount: 0, apps: [] }; }
}
function sendTelemetry() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('telemetry', { connectedAt, ...lastTele });
}
function startTelemetry() {
  stopTelemetry();
  let tick = 0;
  const pump = async () => {
    if (teleBusy || !state.connected) return;
    teleBusy = true;
    try {
      const r = await listTunnelApps(
        [socksPort()],
        engine ? engine.pid : (externalEnginePid || -1),
        process.pid,
      );
      lastTele.connCount = r.connCount; lastTele.apps = r.apps;
      if (tick % 2 === 0) lastTele.latencyMs = await tcpPing(gatewayIp, 443);
      if (shouldProbe(tick) && !probeInFlight) {
        probeInFlight = true;
        // Deliberately not awaited. The probe deadline is longer than the tick
        // interval and recovery is longer still, so awaiting it here would hold
        // `teleBusy` and freeze the live counters for the whole probe.
        checkTunnelHealth()
          .catch(() => {})
          .finally(() => { probeInFlight = false; });
      }
      sendTelemetry();
    } finally {
      // Advance even if a step above threw, otherwise the next pump repeats the
      // same tick and probes the tunnel again immediately.
      tick++;
      teleBusy = false;
    }
  };
  pump();
  telemetryTimer = setInterval(pump, TELEMETRY_TICK_MS);
}
function stopTelemetry() {
  if (telemetryTimer) clearInterval(telemetryTimer);
  telemetryTimer = null;
  lastTele = { connCount: 0, apps: [], latencyMs: null };
  tunnelProbeFailures = 0;
}

async function checkTunnelHealth() {
  if (!state.connected || tunnelRecoveryInFlight) return;
  const probeOptions = {
    proxyPort: socksPort(),
    targetPort: 443,
    timeoutMs: PROBE_TIMEOUT_MS,
  };
  const first = await probeSocksConnect({
    ...probeOptions,
    targetHost: 'www.hkust-gz.edu.cn',
  });
  const second = first || await probeSocksConnect({
    ...probeOptions,
    targetHost: 'library.hkust-gz.edu.cn',
  });
  if (second) {
    tunnelProbeFailures = 0;
    lastHealthyAt = Date.now();
    if (/校园隧道无响应/.test(state.lastError || '')) state.lastError = null;
    emit();
    return;
  }
  tunnelProbeFailures++;
  emit();
  if (!shouldRecover({
    failures: tunnelProbeFailures,
    autoReconnect: loadSettings().autoReconnect,
  })) return;

  tunnelRecoveryInFlight = true;
  state.lastError = '校园隧道无响应，正在自动恢复…';
  emit();
  try {
    await reconnect();
  } finally {
    tunnelProbeFailures = 0;
    tunnelRecoveryInFlight = false;
  }
}

async function runDiagnostics() {
  if (diagnosticsInFlight) return diagnosticsInFlight;
  diagnosticsInFlight = (async () => {
    const startedAt = Date.now();
    lastDiagnostics = { running: true, checkedAt: null, durationMs: null, checks: [] };
    emit();

    const port = socksPort();
    const enginePid = engine ? engine.pid : externalEnginePid;
    const engineRunning = !!enginePid;
    const [listener, ownerPid, campus, gateway, relay] = await Promise.all([
      probeTcpEndpoint({ port, timeoutMs: 1500 }),
      listeningPid(port),
      engineRunning
        ? probeSocksConnect({
          proxyPort: port,
          targetHost: 'www.hkust-gz.edu.cn',
          targetPort: 443,
          timeoutMs: PROBE_TIMEOUT_MS,
        })
        : Promise.resolve(false),
      probeTcpEndpoint({ host: GATEWAY_HOST, port: 443, timeoutMs: 3000 }),
      probeTcpEndpoint({ port: 1081, timeoutMs: 1000 }),
    ]);
    const listenerOwned = listener.ok && engineRunning && ownerPid === enginePid;

    const checks = [
      {
        id: 'engine',
        label: 'Engine process',
        status: engineRunning ? 'pass' : 'fail',
        detail: engine
          ? 'Running under this app'
          : externalEnginePid
            ? `Attached to shared engine process ${externalEnginePid}`
            : 'Not running',
        required: true,
      },
      {
        id: 'listener',
        label: 'SOCKS listener ownership',
        status: listenerOwned ? 'pass' : 'fail',
        detail: listenerOwned
          ? `Shared engine on 127.0.0.1:${port}`
          : listener.ok
            ? ownerPid
              ? `Port ${port} is owned by unexpected process ${ownerPid}`
              : `Port ${port} responds, but its owner could not be verified`
            : `No listener on 127.0.0.1:${port}`,
        required: true,
      },
      {
        id: 'campus',
        label: 'Campus data path and DNS',
        status: campus ? 'pass' : 'fail',
        detail: campus ? 'Campus hostname responded through SOCKS5' : 'Approved campus probe failed',
        required: true,
      },
      {
        id: 'gateway',
        label: 'Gateway reachability',
        status: gateway.ok ? 'pass' : 'fail',
        detail: gateway.ok ? `${Math.round(gateway.latencyMs)} ms` : 'Gateway TCP connection failed',
        required: false,
      },
      {
        id: 'relay',
        label: 'Shadowrocket relay',
        status: relay.ok ? 'pass' : 'unavailable',
        detail: relay.ok ? 'Listening on 127.0.0.1:1081' : 'Not installed or not running',
        required: false,
      },
    ];

    if (diagnosticsAreHealthy(checks)) {
      lastHealthyAt = Date.now();
      tunnelProbeFailures = 0;
      if (/校园隧道无响应/.test(state.lastError || '')) state.lastError = null;
    } else if (state.connected) {
      tunnelProbeFailures = Math.max(1, tunnelProbeFailures);
    }
    lastDiagnostics = {
      running: false,
      checkedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      checks,
    };
    emit();
    return lastDiagnostics;
  })();
  try { return await diagnosticsInFlight; }
  finally { diagnosticsInFlight = null; }
}

// ---------- PAC file (advanced app integration; no DNS probing) ----------
function refreshPacFile(settings = loadSettings()) {
  const policy = loadPolicy();
  fs.writeFileSync(
    PAC_FILE,
    buildPac(settings.routeDomains, Number(settings.port), policy.routeIpv4Cidrs),
    { mode: 0o600 },
  );
  ensureOwnerOnly(PAC_FILE);
}
function pacUrl() { return pathToFileURL(PAC_FILE).href; }

function getCampusBrowser() {
  if (!campusBrowser) {
    const credentialVault = new CampusCredentialVault({
      filePath: CAMPUS_CREDENTIALS,
      safeStorage,
      platform: process.platform,
    });
    campusBrowser = new CampusBrowser({
      BrowserWindow,
      WebContentsView,
      session,
      dialog,
      credentialVault,
      parentWindow: () => win,
      toolbarFile: path.join(__dirname, 'renderer', 'campus-browser.html'),
      campusPreload: path.join(__dirname, 'campus-preload.js'),
      onError: (message) => {
        state.lastError = message;
        emit();
      },
    });
  }
  return campusBrowser;
}

async function connectAndOpenCampusBrowser(rawUrl) {
  let url;
  try {
    url = normalizeCampusUrl(rawUrl);
  } catch (error) {
    state.lastError = error.message;
    emit();
    return { ok: false, error: error.message };
  }

  if (!state.connected || !lastHealthyAt) {
    if (!state.connected) await connect();
    if (!await waitForConnected()) {
      const error = state.lastError || '连接校园网络超时，请重试或查看日志';
      state.lastError = error;
      emit();
      return { ok: false, error };
    }
  }

  try {
    await getCampusBrowser().open(url, socksPort());
    return { ok: true, url };
  } catch (error) {
    const message = `校园浏览器启动失败：${error.message}`;
    state.lastError = message;
    emit();
    return { ok: false, error: message };
  }
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => {
  const passwordPresent = hasPassword();
  return {
    ...publicRuntimeState(), settings: { ...loadSettings(), ...loadPolicy() },
    hasPassword: passwordPresent, pacUrl: pacUrl(),
    loggedIn: (passwordPresent && !!loadSettings().username) || !!externalEnginePid,
    platform: process.platform,
    version: app.getVersion(), campusResources: loadCampusResources(), telemetry: lastTele,
  };
});
ipcMain.handle('save', async (_e, p) => {
  const previous = loadSettings();
  let next;
  let portChanged;
  let nextPolicy;
  let policyChanged;
  try {
    ({ settings: next, portChanged } = applySettingsPatch(previous, p));
    const currentPolicy = loadPolicy();
    const policyWasSubmitted = p && (
      Object.prototype.hasOwnProperty.call(p, 'vpnDnsServers')
      || Object.prototype.hasOwnProperty.call(p, 'routeIpv4Cidrs')
    );
    nextPolicy = policyWasSubmitted
      ? normalizeNetworkPolicy({
        vpnDnsServers: p.vpnDnsServers,
        routeIpv4Cidrs: p.routeIpv4Cidrs,
      })
      : currentPolicy;
    policyChanged = !networkPoliciesEqual(currentPolicy, nextPolicy);
  } catch (error) {
    return { ok: false, error: error.message, settings: { ...previous, ...loadPolicy() } };
  }
  next = saveSettings(next);
  if (policyChanged) nextPolicy = saveNetworkPolicy(POLICY, nextPolicy);
  // The PAC file only serves external applications. A write failure must not
  // discard the settings that were already stored, nor the password below it.
  let pacError = null;
  try {
    refreshPacFile(next);
  } catch (error) {
    pacError = `设置已保存，但 PAC 文件写入失败：${error.message}`;
  }
  if (p && typeof p.password === 'string' && p.password.length && !await savePassword(p.password)) {
    return { ok: false, error: '系统安全存储不可用，密码未保存' };
  }
  if (p && typeof p.startAtLogin === 'boolean') { try { app.setLoginItemSettings({ openAtLogin: p.startAtLogin }); } catch {} }
  let reconnected = false;
  if ((engine || externalEnginePid) && (portChanged || (policyChanged && engine))) {
    await reconnect();
    reconnected = true;
  }
  if (campusBrowser && portChanged) await campusBrowser.configure(next.port);
  if (policyChanged && externalEnginePid) {
    const ownershipWarning = 'Network policy saved. Restart the tunnel from the interface that owns it to apply engine routes.';
    pacError = pacError ? `${pacError} ${ownershipWarning}` : ownershipWarning;
  }
  if (pacError) {
    state.lastError = pacError;
    emit();
  }
  return {
    ok: true,
    warning: pacError,
    settings: { ...next, ...nextPolicy },
    portChanged,
    reconnected,
  };
});
ipcMain.handle('connect', async () => { await connect(); return { ok: true }; });
ipcMain.handle('disconnect', () => { disconnect(); return { ok: true }; });
ipcMain.handle('reconnect', reconnect);
ipcMain.handle('run-diagnostics', runDiagnostics);
ipcMain.handle('ssh-config', () => {
  const port = socksPort();
  const note = '# Direct Host blocks only; do not combine with ProxyJump.';
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
    ].filter(Boolean);
    const candidates = roots.map((root) => path.join(root, 'Git', 'mingw64', 'bin', 'connect.exe'));
    const connectExe = (candidates.find((candidate) => fs.existsSync(candidate)) || 'connect.exe').replace(/\\/g, '/');
    return `${note}\nProxyCommand "${connectExe}" -S 127.0.0.1:${port} %h %p`;
  }
  return `${note}\nProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:${port} %h %p`;
});
ipcMain.handle('logout', () => {
  disconnect();
  passwordSession.forget();
  return { ok: true };
});
ipcMain.handle('get-logs', () => {
  return readLogTail(LOG);
});
ipcMain.handle('open-log', () => shell.openPath(LOG));
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
ipcMain.handle('open-campus-browser', (_event, url) => connectAndOpenCampusBrowser(url));
ipcMain.handle('resize', () => {});

// ---------- window ----------
function showWindow() {
  if (!app.isReady()) return;
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  updateTray();
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
    updateTray();
    return;
  }
  showWindow();
}

function updateLoginItem(enabled) {
  const options = { openAtLogin: enabled };
  if (process.platform === 'darwin') options.openAsHidden = true;
  try { app.setLoginItemSettings(options); } catch {}
}

function setStartAtLogin(enabled) {
  try {
    const next = loadSettings();
    next.startAtLogin = enabled;
    saveSettings(next);
    updateLoginItem(enabled);
    updateTray();
  } catch (error) {
    state.lastError = `Could not update launch-at-login: ${error.message}`;
    emit();
  }
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const status = {
    healthy: 'Connected',
    checking: 'Checking connection',
    degraded: 'Needs attention',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    blocked: 'Connection blocked',
    disconnected: 'Disconnected',
  }[publicRuntimeState().operationalState];
  const windowVisible = !!(win && !win.isDestroyed() && win.isVisible());
  const connectionActive = state.connected || state.connecting;
  const settings = loadSettings();
  tray.setToolTip(`HKUST(GZ) Connect - ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: windowVisible ? 'Hide Control Window' : 'Open Control Window', click: toggleWindow },
    { label: `Status: ${status}`, enabled: false },
    { type: 'separator' },
    {
      label: connectionActive ? 'Disconnect' : 'Connect to Campus Network',
      click: () => { if (connectionActive) disconnect(); else void connect(); },
    },
    { label: 'Restart Tunnel', enabled: connectionActive, click: () => { void reconnect(); } },
    { label: 'Run Health Checks', click: () => { void runDiagnostics(); } },
    { label: 'Open Campus Browser', click: () => { void connectAndOpenCampusBrowser(''); } },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: settings.startAtLogin,
      click: (item) => setStartAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit HKUST(GZ) Connect', click: requestQuit },
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return true;
  const iconName = process.platform === 'darwin'
    ? 'trayTemplate.png'
    : process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const image = loadTrayImage(nativeImage, path.join(__dirname, 'build', iconName), process.platform);
  if (image.isEmpty()) return false;
  tray = new Tray(image);
  tray.on('click', toggleWindow);
  updateTray();
  return true;
}

function hideToTray() {
  if (!createTray()) return false;
  if (win && !win.isDestroyed()) win.hide();
  return true;
}

function rememberCloseAction(action) {
  const next = loadSettings();
  next.closeAction = action;
  saveSettings(next);
}

function requestQuit() {
  if (isQuitting) return;
  isQuitting = true;
  app.quit();
}

async function handleWindowClose(event) {
  if (isQuitting) return;
  event.preventDefault();

  const action = loadSettings().closeAction;
  if (action === 'quit') {
    requestQuit();
    return;
  }
  if (action === 'minimize') {
    hideToTray();
    return;
  }
  if (closePromptOpen || !win || win.isDestroyed()) return;

  closePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Close HKUST(GZ) Connect',
      message: 'What should happen when you close the control window?',
      detail: 'Keeping the app in the menu bar preserves the campus network connection.',
      buttons: ['Keep in Menu Bar', 'Quit Application', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: 'Remember this choice (you can change it in Settings)',
      checkboxChecked: false,
    });

    if (result.response === 0) {
      if (result.checkboxChecked) rememberCloseAction('minimize');
      hideToTray();
    } else if (result.response === 1) {
      if (result.checkboxChecked) rememberCloseAction('quit');
      requestQuit();
    }
  } finally {
    closePromptOpen = false;
  }
}

function createWindow({ show = true } = {}) {
  win = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 680,
    minHeight: 540,
    resizable: true,
    fullscreenable: false,
    maximizable: true,
    title: 'HKUST(GZ) Connect',
    backgroundColor: '#ffffff',
    show,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      devTools: !app.isPackaged,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The control window only ever renders its own bundled page. Deny popups and
  // navigation away from it so a future renderer change cannot turn it into a
  // browser with main-process privileges.
  const controlContents = win.webContents;
  controlContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controlContents.on('will-navigate', (event, url) => {
    if (url !== controlContents.getURL()) event.preventDefault();
  });
  controlContents.on('will-attach-webview', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', handleWindowClose);
  win.on('show', updateTray);
  win.on('hide', updateTray);
  win.on('closed', () => { win = null; });
}

function installApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'HKUST(GZ) Connect',
      submenu: [
        { role: 'about', label: 'About HKUST(GZ) Connect' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide HKUST(GZ) Connect' },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit HKUST(GZ) Connect' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'close', label: 'Close Window' },
      ],
    },
  ]));
}

app.on('second-instance', showWindow);
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  installApplicationMenu();
  // A PAC write can fail on a read-only or full user-data directory. That must
  // not leave the user with no window and no tray, so it is reported through the
  // normal error surface instead of aborting startup.
  try {
    refreshPacFile();
  } catch (error) {
    state.lastError = `无法写入 PAC 文件：${error.message}`;
  }
  createTray();
  const settings = loadSettings();
  updateLoginItem(settings.startAtLogin);
  let openedAtLogin = false;
  if (process.platform === 'darwin') {
    try { openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true; } catch {}
  }
  createWindow({ show: !openedAtLogin });
  if (settings.autoConnect !== false) setTimeout(() => connect(), 500);
  app.on('activate', showWindow);
}).catch((error) => {
  dialog.showErrorBox('HKUST(GZ) Connect 启动失败', String(error && error.message ? error.message : error));
  app.exit(1);
});
app.on('window-all-closed', () => { /* Keep the tray process alive. */ });
app.on('before-quit', () => {
  isQuitting = true;
  disconnect();
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});
