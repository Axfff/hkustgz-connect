'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'styles.css'),
  'utf8',
);
const renderer = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'app.js'),
  'utf8',
);
const html = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'index.html'),
  'utf8',
);

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1].replace(/\s+/g, ' ');
}

test('the control window constrains scrolling to its content pane', () => {
  assert.match(rule('.app-shell'), /min-height:\s*0/);
  assert.match(rule('.app-shell'), /overflow:\s*hidden/);
  assert.match(rule('.main'), /min-height:\s*0/);
  assert.match(rule('.main'), /overflow:\s*hidden/);
  assert.match(rule('.page-scroll'), /overflow-y:\s*auto/);
  assert.match(rule('.page-scroll'), /overscroll-behavior:\s*contain/);
});

test('each application page keeps an independent scroll position', () => {
  assert.match(renderer, /pageScrollPositions\.set\(currentPage, scroller\.scrollTop\)/);
  assert.match(renderer, /scroller\.scrollTop = pageScrollPositions\.get\(page\) \|\| 0/);
});

test('every literal renderer element reference exists in the document', () => {
  const referencedIds = new Set(
    [...renderer.matchAll(/\$\(\s*(['"])([^'"]+)\1\s*\)/g)]
      .map((match) => match[2]),
  );
  const documentIds = new Set(
    [...html.matchAll(/\bid=(['"])([^'"]+)\1/g)]
      .map((match) => match[2]),
  );
  const missingIds = [...referencedIds].filter((id) => !documentIds.has(id));

  assert.ok(referencedIds.size > 0, 'renderer element reference extraction returned no IDs');
  assert.deepEqual(missingIds, [], `renderer references missing document IDs: ${missingIds.join(', ')}`);
});

test('network compatibility exposes the supported integrations and actions', () => {
  assert.match(html, /<h2>Network compatibility<\/h2>/);

  for (const integration of [
    'Browser / PAC',
    'Shadowrocket',
    'Clash / Mihomo',
    'Tailscale',
  ]) {
    assert.match(html, new RegExp(`<strong>${integration.replace('/', '\\/')}<\\/strong>`));
  }

  for (const copyTarget of ['pac', 'shadowrocket', 'mihomo']) {
    assert.match(html, new RegExp(`data-copy="${copyTarget}"`));
  }

  for (const guideTarget of ['browser', 'shadowrocket', 'mihomo', 'tailscale']) {
    assert.match(html, new RegExp(`data-guide="${guideTarget}"`));
  }

  assert.match(html, /id="shadowrocketPreset"/);
  assert.match(html, /<option value="campus">Campus only<\/option>/);
  assert.match(html, /<option value="repair">Realtime\/DNS repair<\/option>/);
  assert.match(html, /id="fallbackServiceButton"/);
  assert.match(html, /id="fallbackRemoveButton"/);
});

test('network compatibility rows remain usable in compact windows', () => {
  assert.match(rule('.integration-row'), /display:\s*grid/);
  assert.match(rule('.integration-row'), /grid-template-columns:\s*minmax\([^)]*1fr\)\s+auto/);
  assert.match(rule('.integration-row > div:first-child'), /min-width:\s*0/);
  assert.match(rule('.integration-actions'), /display:\s*flex/);
  assert.match(rule('.integration-actions.wrap'), /flex-wrap:\s*wrap/);

  const compactMediaStart = css.indexOf('@media (max-width: 600px)');
  assert.notEqual(compactMediaStart, -1, 'missing compact-window media query');
  const compactMedia = css.slice(compactMediaStart);
  assert.match(compactMedia, /\.integration-row\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(compactMedia, /\.integration-actions\s*\{[^}]*flex-wrap:\s*wrap/);
});
