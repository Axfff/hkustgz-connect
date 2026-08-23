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
