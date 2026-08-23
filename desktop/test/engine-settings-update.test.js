'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { planEngineSettingsUpdate } = require('../lib/engine-settings-update');

test('a shared engine blocks campus port changes without requesting a reconnect', () => {
  const plan = planEngineSettingsUpdate({
    engineOwner: 'shared',
    portChanged: true,
    policyChanged: false,
  });

  assert.equal(plan.allowed, false);
  assert.equal(plan.reconnect, false);
  assert.equal(plan.warning, null);
  assert.match(plan.error, /owned by the CLI or another interface/);
  assert.match(plan.error, /was not stopped and no settings were changed/);
});

test('an app-owned engine reconnects after its campus port changes', () => {
  const plan = planEngineSettingsUpdate({
    engineOwner: 'app',
    portChanged: true,
    policyChanged: false,
  });

  assert.equal(plan.allowed, true);
  assert.equal(plan.reconnect, true);
  assert.equal(plan.error, null);
});

test('policy-only updates keep a shared engine attached and tell its owner to restart', () => {
  const plan = planEngineSettingsUpdate({
    engineOwner: 'shared',
    portChanged: false,
    policyChanged: true,
  });

  assert.equal(plan.allowed, true);
  assert.equal(plan.reconnect, false);
  assert.match(plan.warning, /interface that owns it/);
});

test('an app-owned engine reconnects after a policy update', () => {
  const plan = planEngineSettingsUpdate({
    engineOwner: 'app',
    portChanged: false,
    policyChanged: true,
  });

  assert.equal(plan.allowed, true);
  assert.equal(plan.reconnect, true);
});

test('unrelated settings never require an engine transition', () => {
  assert.deepEqual(
    planEngineSettingsUpdate({
      engineOwner: null,
      portChanged: false,
      policyChanged: false,
    }),
    {
      allowed: true,
      reconnect: false,
      warning: null,
      error: null,
    },
  );
});

test('the main process rejects a blocked transition before persisting settings', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const handler = main.slice(
    main.indexOf("ipcMain.handle('save'"),
    main.indexOf("ipcMain.handle('connect'"),
  );
  const planIndex = handler.indexOf('planEngineSettingsUpdate({');
  const rejectionIndex = handler.indexOf('if (!engineSettingsPlan.allowed)');
  const saveIndex = handler.indexOf('saveSettings(next)');

  assert.ok(planIndex >= 0, 'save handler must create an ownership transition plan');
  assert.ok(rejectionIndex > planIndex, 'save handler must reject a blocked plan');
  assert.ok(saveIndex > rejectionIndex, 'ownership rejection must happen before settings are written');
});
