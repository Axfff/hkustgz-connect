'use strict';

const fs = require('fs');
const { ensureOwnerOnly } = require('./private-file');

const UNREAD = Symbol('unread password');

function protectedStorageAvailable(safeStorage, platform) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function savePassword(file, password, safeStorage, platform) {
  if (!password || !protectedStorageAvailable(safeStorage, platform)) return false;
  fs.writeFileSync(file, safeStorage.encryptString(String(password)), { mode: 0o600 });
  ensureOwnerOnly(file);
  return true;
}

function loadPassword(file, safeStorage, platform) {
  try {
    if (!protectedStorageAvailable(safeStorage, platform)) return '';
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return '';
  }
}

class PasswordSession {
  constructor({ file, safeStorage, platform }) {
    this.file = file;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.value = UNREAD;
    this.loadPromise = null;
  }

  async useAsyncStorage(method) {
    if (typeof this.safeStorage.isAsyncEncryptionAvailable !== 'function' ||
        typeof this.safeStorage[method] !== 'function') {
      return false;
    }
    return this.safeStorage.isAsyncEncryptionAvailable();
  }

  async decrypt(ciphertext, useAsync) {
    if (useAsync) {
      return this.safeStorage.decryptStringAsync(ciphertext);
    }
    return {
      result: this.safeStorage.decryptString(ciphertext),
      shouldReEncrypt: false,
    };
  }

  async encrypt(value, useAsync) {
    if (useAsync) {
      return this.safeStorage.encryptStringAsync(value);
    }
    return this.safeStorage.encryptString(value);
  }

  async readFromDisk() {
    try {
      if (!fs.existsSync(this.file)) return '';
      const useAsync = await this.useAsyncStorage('decryptStringAsync');
      if (!useAsync && !protectedStorageAvailable(this.safeStorage, this.platform)) return '';
      const decrypted = await this.decrypt(fs.readFileSync(this.file), useAsync);
      const result = String(decrypted.result || '');
      if (result && decrypted.shouldReEncrypt &&
          typeof this.safeStorage.encryptStringAsync === 'function') {
        await this.writeToDisk(result, useAsync);
      }
      return result;
    } catch {
      return '';
    }
  }

  async writeToDisk(value, useAsync) {
    const ciphertext = await this.encrypt(value, useAsync);
    fs.writeFileSync(this.file, ciphertext, { mode: 0o600 });
    ensureOwnerOnly(this.file);
  }

  async load() {
    if (this.value !== UNREAD) return this.value;
    if (!this.loadPromise) {
      this.loadPromise = this.readFromDisk().then((result) => {
        if (this.value === UNREAD) this.value = result;
        return this.value;
      }).finally(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  async has() {
    return !!await this.load();
  }

  hasStored() {
    try { return fs.statSync(this.file).size > 0; }
    catch { return false; }
  }

  async save(password) {
    const value = String(password || '');
    if (!value) return false;
    try {
      const useAsync = await this.useAsyncStorage('encryptStringAsync');
      if (!useAsync && !protectedStorageAvailable(this.safeStorage, this.platform)) return false;
      await this.writeToDisk(value, useAsync);
      this.value = value;
      return true;
    } catch {
      return false;
    }
  }

  forget() {
    this.value = '';
    try { fs.unlinkSync(this.file); } catch {}
  }
}

module.exports = {
  PasswordSession,
  loadPassword,
  protectedStorageAvailable,
  savePassword,
};
