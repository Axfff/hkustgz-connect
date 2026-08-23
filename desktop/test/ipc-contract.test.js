'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(desktopRoot, 'renderer', 'app.js'), 'utf8');
const preload = fs.readFileSync(path.join(desktopRoot, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');

function captureSet(source, expression, captureIndex) {
  return new Set([...source.matchAll(expression)].map((match) => match[captureIndex]));
}

test('renderer API calls are exposed by the preload bridge', () => {
  const rendererMethods = captureSet(renderer, /\bwindow\.api\.([A-Za-z_$][\w$]*)\b/g, 1);
  const preloadMethods = captureSet(
    preload,
    /^\s+([A-Za-z_$][\w$]*):\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm,
    1,
  );
  const missingMethods = [...rendererMethods].filter((method) => !preloadMethods.has(method));

  assert.ok(rendererMethods.size > 0, 'renderer API extraction returned no methods');
  assert.ok(preloadMethods.size > 0, 'preload bridge extraction returned no methods');
  assert.deepEqual(
    missingMethods,
    [],
    `renderer methods missing from preload bridge: ${missingMethods.join(', ')}`,
  );
});

test('every preload invoke channel has a main-process handler', () => {
  const invokeChannels = captureSet(
    preload,
    /\bipcRenderer\.invoke\(\s*(['"])([^'"]+)\1/g,
    2,
  );
  const handleChannels = captureSet(
    main,
    /\bipcMain\.handle\(\s*(['"])([^'"]+)\1/g,
    2,
  );
  const missingHandlers = [...invokeChannels].filter((channel) => !handleChannels.has(channel));

  assert.ok(invokeChannels.size > 0, 'preload invoke-channel extraction returned no channels');
  assert.ok(handleChannels.size > 0, 'main handler extraction returned no channels');
  assert.deepEqual(
    missingHandlers,
    [],
    `preload invoke channels missing main handlers: ${missingHandlers.join(', ')}`,
  );
});

test('relay lifecycle mutations are serialized in both renderer and main process', () => {
  assert.match(renderer, /function setFallbackServiceBusy\(busy\)/);
  assert.match(renderer, /fallbackServiceButton'\)\.disabled = busy/);
  assert.match(renderer, /fallbackRemoveButton'\)\.disabled = busy/);
  assert.match(main, /function withFallbackMutation\(task\)/);
  assert.match(main, /acquireRelayOperationLock\(\{/);
  assert.match(main, /lockFile: FALLBACK_OPERATION_LOCK/);
  assert.match(main, /lease\.release\(\)/);
  assert.match(main, /withFallbackMutation\(\(\) => removeFallbackService/);
});

test('state refresh awaits relay inspection before capturing runtime state', () => {
  const handler = main.slice(
    main.indexOf("ipcMain.handle('get-state'"),
    main.indexOf("ipcMain.handle('save'"),
  );
  assert.ok(handler.indexOf('await fallbackRuntimeState()') < handler.indexOf('publicRuntimeState()'));
});

test('public diagnostics probe both HTTPS prerequisite hosts in parallel', () => {
  const diagnostics = main.slice(
    main.indexOf('async function runDiagnostics()'),
    main.indexOf('// ---------- PAC file'),
  );
  assert.match(main, /PUBLIC_HTTPS_HOSTS = Object\.freeze\(\['chatgpt\.com', 'ws\.chatgpt\.com'\]\)/);
  assert.equal(
    [...diagnostics.matchAll(/Promise\.all\(PUBLIC_HTTPS_HOSTS\.map/g)].length,
    2,
  );
  assert.match(diagnostics, /persistent realtime was not verified/);
});
