'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadCampusResources, normalizeCampusResourceUrl, normalizeResource, openCampusResource,
} = require('../lib/campus-resources');

test('bundled campus resources are unique reviewed HTTPS links', () => {
  const resources = loadCampusResources();
  assert.ok(resources.length >= 3);
  assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
  assert.ok(resources.some((resource) => resource.url === 'https://unikorn.hkust-gz.edu.cn/'));
  assert.ok(resources.some((resource) => resource.url === 'https://onlinejudge.hkust-gz.edu.cn/'));
  for (const resource of resources) {
    assert.match(resource.url, /^https:\/\/[^/]+/);
    assert.ok(resource.name.length > 0);
  }
});

test('invalid or executable resource entries are rejected', () => {
  assert.equal(normalizeResource({ id: 'bad space', name: 'Bad', url: 'https://example.com' }), null);
  assert.equal(normalizeResource({ id: 'bad', name: 'Bad', url: 'javascript:alert(1)' }), null);
  assert.throws(() => normalizeCampusResourceUrl('http://unikorn.hkust-gz.edu.cn'), /HTTPS/);
  assert.throws(() => normalizeCampusResourceUrl('https://example.com'), /HKUST/);
  assert.throws(() => normalizeCampusResourceUrl('https://user:pass@unikorn.hkust-gz.edu.cn'), /HKUST/);
});

test('campus links open through the operating-system browser callback', async () => {
  const opened = [];
  const url = await openCampusResource(
    'https://onlinejudge.hkust-gz.edu.cn',
    async (value) => opened.push(value),
  );
  assert.equal(url, 'https://onlinejudge.hkust-gz.edu.cn/');
  assert.deepEqual(opened, [url]);
});
