'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PasswordSession } = require('../lib/credential-store');

function temporaryCredential(t, contents = Buffer.from('ciphertext')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-password-session-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'cred.bin');
  if (contents) fs.writeFileSync(file, contents, { mode: 0o600 });
  return file;
}

test('concurrent startup reads share one secure-storage request', async (t) => {
  const file = temporaryCredential(t);
  let decryptions = 0;
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    decryptStringAsync: async () => {
      decryptions += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { result: 'campus-secret', shouldReEncrypt: false };
    },
  };
  const session = new PasswordSession({ file, safeStorage, platform: 'darwin' });

  assert.equal(session.hasStored(), true);
  assert.deepEqual(
    await Promise.all([session.load(), session.has(), session.load()]),
    ['campus-secret', true, 'campus-secret'],
  );
  assert.equal(await session.load(), 'campus-secret');
  assert.equal(decryptions, 1);
});

test('a denied secure-storage read is not requested again in the same session', async (t) => {
  const file = temporaryCredential(t);
  let decryptions = 0;
  const session = new PasswordSession({
    file,
    platform: 'darwin',
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      decryptStringAsync: async () => {
        decryptions += 1;
        throw new Error('user canceled');
      },
    },
  });

  assert.equal(await session.load(), '');
  assert.equal(await session.load(), '');
  assert.equal(decryptions, 1);
});

test('an unavailable async provider falls back to the existing synchronous credential', async (t) => {
  const file = temporaryCredential(t);
  let synchronousDecryptions = 0;
  const session = new PasswordSession({
    file,
    platform: 'darwin',
    safeStorage: {
      isAsyncEncryptionAvailable: async () => false,
      isEncryptionAvailable: () => true,
      encryptStringAsync: async () => { throw new Error('must not use async storage'); },
      decryptStringAsync: async () => { throw new Error('must not use async storage'); },
      decryptString: () => {
        synchronousDecryptions += 1;
        return 'existing-secret';
      },
    },
  });

  assert.equal(await session.load(), 'existing-secret');
  assert.equal(await session.load(), 'existing-secret');
  assert.equal(synchronousDecryptions, 1);
});

test('saving updates the session cache and forgetting clears disk and memory', async (t) => {
  const file = temporaryCredential(t, null);
  let decryptions = 0;
  const session = new PasswordSession({
    file,
    platform: 'darwin',
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
      decryptStringAsync: async () => {
        decryptions += 1;
        return { result: 'unexpected', shouldReEncrypt: false };
      },
    },
  });

  assert.equal(session.hasStored(), false);
  assert.equal(await session.save('new-secret'), true);
  assert.equal(session.hasStored(), true);
  assert.equal(await session.load(), 'new-secret');
  assert.equal(decryptions, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'encrypted:new-secret');

  session.forget();
  assert.equal(session.hasStored(), false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await session.load(), '');
});
