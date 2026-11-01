import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLunacyServer } from '../index.js';

async function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunacy-test-'));
  const server = createLunacyServer({ dataDir, bootstrapKey: 'test-owner-key-1234567890' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

async function api(base, route, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

test('owner cleverok is seeded and bootstrap login grants creator', async () => {
  const app = await fixture();
  try {
    const guest = await api(app.base, '/api/session/guest', { method: 'POST', body: { handle: '@cleverok', gameName: 'Owner' } });
    assert.equal(guest.status, 200);
    assert.equal(guest.data.user.role, 'creator');
    assert.equal(guest.data.authenticated, false);
    const denied = await api(app.base, '/api/admin/users', { token: guest.data.token });
    assert.equal(denied.status, 403);
    const login = await api(app.base, '/api/session/login', { method: 'POST', body: { handle: 'cleverok', key: 'test-owner-key-1234567890', gameName: 'Owner' } });
    assert.equal(login.status, 200);
    assert.equal(login.data.authenticated, true);
    assert.equal(login.data.user.role, 'creator');
    const users = await api(app.base, '/api/admin/users', { token: login.data.token });
    assert.equal(users.status, 200);
    assert.equal(users.data.users[0].handle, 'cleverok');
  } finally { await app.close(); }
});

test('creator assigns nickname, visuals and role by handle', async () => {
  const app = await fixture();
  try {
    const login = await api(app.base, '/api/session/login', { method: 'POST', body: { handle: 'cleverok', key: 'test-owner-key-1234567890' } });
    const token = login.data.token;
    const update = await api(app.base, '/api/admin/users/user-a1a559ff38d09716', {
      method: 'PUT', token, body: {
        role: 'tester', gameName: 'Руслан',
        nickname: { enabled: true, mode: 'rainbow', colors: ['#2cc9ff', '#ff4f9a'], glow: 20, speed: 1.5 },
        visuals: { comets: true, crystals: true, guns: false, revolver: true }
      }
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.user.role, 'tester');
    assert.equal(update.data.user.nickname.mode, 'rainbow');
    assert.equal(update.data.user.visuals.revolver, true);
    const guest = await api(app.base, '/api/session/guest', { method: 'POST', body: { handle: '@user-a1a559ff38d09716', gameName: 'Руслан' } });
    assert.equal(guest.data.user.nickname.glow, 20);
    assert.equal(guest.data.user.visuals.comets, true);
  } finally { await app.close(); }
});

test('admin cannot promote users or edit creator', async () => {
  const app = await fixture();
  try {
    const owner = await api(app.base, '/api/session/login', { method: 'POST', body: { handle: 'cleverok', key: 'test-owner-key-1234567890' } });
    const ownerToken = owner.data.token;
    const made = await api(app.base, '/api/admin/users/mod', { method: 'PUT', token: ownerToken, body: { role: 'admin' } });
    assert.equal(made.status, 200);
    const key = await api(app.base, '/api/admin/users/mod/key', { method: 'POST', token: ownerToken });
    const admin = await api(app.base, '/api/session/login', { method: 'POST', body: { handle: 'mod', key: key.data.key } });
    const denied = await api(app.base, '/api/admin/users/mod', { method: 'PUT', token: admin.data.token, body: { role: 'creator' } });
    assert.equal(denied.status, 403);
    const allowed = await api(app.base, '/api/admin/users/player', { method: 'PUT', token: admin.data.token, body: { role: 'tester' } });
    assert.equal(allowed.status, 200);
    const ownerDenied = await api(app.base, '/api/admin/users/cleverok', { method: 'PUT', token: admin.data.token, body: { role: 'user' } });
    assert.equal(ownerDenied.status, 403);
  } finally { await app.close(); }
});

test('validation and malformed JSON fail safely', async () => {
  const app = await fixture();
  try {
    const bad = await api(app.base, '/api/session/guest', { method: 'POST', body: { handle: '@' } });
    assert.equal(bad.status, 400);
    const response = await fetch(app.base + '/api/session/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(response.status, 400);
    const health = await api(app.base, '/api/health');
    assert.equal(health.data.ok, true);
  } finally { await app.close(); }
});
