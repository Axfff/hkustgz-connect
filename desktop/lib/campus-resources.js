'use strict';

const fs = require('fs');
const path = require('path');

const RESOURCE_FILE = path.join(__dirname, '..', 'assets', 'campus-resources.json');
const MAX_RESOURCES = 32;
const CAMPUS_SUFFIXES = ['hkust-gz.edu.cn', 'hkust.edu.hk'];

function normalizeCampusResourceUrl(value) {
  const parsed = new URL(String(value || '').trim());
  const host = parsed.hostname.toLowerCase();
  const campusOwned = CAMPUS_SUFFIXES.some((suffix) => (
    host === suffix || host.endsWith(`.${suffix}`)
  ));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== '443') || !campusOwned) {
    throw new Error('Campus resource must be an HKUST HTTPS URL');
  }
  return parsed.href;
}

async function openCampusResource(value, openExternal) {
  if (typeof openExternal !== 'function') throw new Error('Default browser is unavailable');
  const url = normalizeCampusResourceUrl(value);
  await openExternal(url);
  return url;
}

function normalizeResource(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const name = String(value.name || '').trim();
  const description = String(value.description || '').trim();
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !name || name.length > 40 || description.length > 80) {
    return null;
  }
  try {
    return {
      id,
      name,
      description,
      url: normalizeCampusResourceUrl(value.url),
    };
  } catch {
    return null;
  }
}

function loadCampusResources(file = RESOURCE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .slice(0, MAX_RESOURCES)
      .map(normalizeResource)
      .filter((resource) => {
        if (!resource || seen.has(resource.id)) return false;
        seen.add(resource.id);
        return true;
      });
  } catch {
    return [];
  }
}

module.exports = {
  CAMPUS_SUFFIXES,
  MAX_RESOURCES,
  RESOURCE_FILE,
  loadCampusResources,
  normalizeCampusResourceUrl,
  normalizeResource,
  openCampusResource,
};
