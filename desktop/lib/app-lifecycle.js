'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['running', 'manual-stopped', 'campus-stopped']);

function validIdentity(value) {
  return value && value.version === 1 && typeof value.session_id === 'string'
    && UUID.test(value.session_id)
    && Number.isInteger(value.pid) && value.pid > 0 && value.pid <= 0x7fffffff;
}

class AppLifecycle {
  constructor({ directory, enabled = true, pid = process.pid }) {
    this.directory = directory;
    this.enabled = enabled;
    this.pid = pid;
    this.sessionFile = path.join(directory, 'app-session.json');
    this.requestFile = path.join(directory, 'campus-shutdown.json');
    this.pauseFile = path.join(directory, 'auto-paused');
    this.session = null;
    this.relayShutdown = false;
  }

  assertPrivateFile(file) {
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()
      || (typeof process.getuid === 'function'
        && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) {
      throw new Error('App lifecycle state must be an owner-only regular file');
    }
    return true;
  }

  readPrivateJson(file) {
    if (!this.assertPrivateFile(file)) return null;
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid app lifecycle state');
      }
      return value;
    }
    finally { fs.closeSync(fd); }
  }

  readSession() {
    const session = this.readPrivateJson(this.sessionFile);
    if (session === null) return null;
    if (!validIdentity(session) || !STATUSES.has(session.status)
      || Object.keys(session).length !== 4) {
      throw new Error('Invalid app lifecycle state');
    }
    return session;
  }

  automaticLaunchAllowed() {
    if (!this.enabled) return true;
    try {
      // Even an invalid pause marker blocks unattended startup.
      try { fs.lstatSync(this.pauseFile); return false; }
      catch (error) { if (error.code !== 'ENOENT') return false; }
      const session = this.readSession();
      return session === null || session.status === 'campus-stopped';
    } catch { return false; }
  }

  writeSession(session) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.assertPrivateFile(this.sessionFile);
    const temporary = path.join(this.directory, `.app-session.${this.pid}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(session)}\n`);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.sessionFile);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  clearShutdownRequest() {
    if (this.assertPrivateFile(this.requestFile)) fs.unlinkSync(this.requestFile);
  }

  beginSession({ automatic = false, login = false } = {}) {
    if (!this.enabled) return true;
    if ((automatic || login) && !this.automaticLaunchAllowed()) return false;
    this.session = { version: 1, session_id: randomUUID(), pid: this.pid, status: 'running' };
    // Write before UI/credentials: Force Quit can never bypass the stop latch.
    this.writeSession(this.session);
    this.clearShutdownRequest();
    return true;
  }

  matchingShutdownRequest() {
    if (!this.session) return false;
    try {
      const request = this.readPrivateJson(this.requestFile);
      const persisted = this.readSession();
      return validIdentity(request) && Object.keys(request).length === 3
        && request.pid === this.session.pid
        && request.session_id === this.session.session_id
        && persisted?.status === 'running' && persisted.pid === this.session.pid
        && persisted.session_id === this.session.session_id;
    } catch { return false; }
  }

  acceptRelayShutdown() {
    this.relayShutdown = this.enabled && this.matchingShutdownRequest();
  }

  finishSession({ manual = false } = {}) {
    if (!this.enabled || !this.session) return;
    const campusShutdown = !manual && this.relayShutdown && this.matchingShutdownRequest();
    this.writeSession({ ...this.session, status: campusShutdown ? 'campus-stopped' : 'manual-stopped' });
    this.clearShutdownRequest();
    this.session = null;
  }
}

module.exports = { AppLifecycle };
