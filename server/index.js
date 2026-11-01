import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROLES = new Set(['user', 'tester', 'admin', 'creator']);
const MODES = new Set(['solid', 'gradient', 'rainbow', 'pulse']);
const VISUALS = ['comets', 'crystals', 'guns', 'revolver'];
const HANDLE_RE = /^[a-zA-Z0-9_-]{2,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ONLINE_MS = 45_000;
const SESSION_MS = 3 * 24 * 60 * 60 * 1000;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const normalizeHandle = value => String(value ?? '').trim().replace(/^@+/, '').toLowerCase();
const safeText = (value, max = 32) => String(value ?? '').trim().slice(0, max);
const randomKey = () => crypto.randomBytes(24).toString('base64url');
const hashKey = (key, pepper) => crypto.createHash('sha256').update(`${pepper}:${key}`).digest('hex');
const equalSecret = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

function roleDefaults(role) {
  const preset = {
    user: {
      nickname: { enabled: true, mode: 'solid', colors: ['#ffffff', '#2cc9ff'], glow: 4, speed: 1 },
      visuals: { comets: true, crystals: true, guns: true, revolver: true }
    },
    tester: {
      nickname: { enabled: true, mode: 'gradient', colors: ['#2cc9ff', '#f5d547'], glow: 10, speed: 1 },
      visuals: { comets: true, crystals: true, guns: false, revolver: false }
    },
    admin: {
      nickname: { enabled: true, mode: 'rainbow', colors: ['#2cc9ff', '#ff4f9a'], glow: 16, speed: 1.2 },
      visuals: { comets: true, crystals: true, guns: true, revolver: true }
    },
    creator: {
      nickname: { enabled: true, mode: 'rainbow', colors: ['#f5d547', '#2cc9ff'], glow: 22, speed: 1.35 },
      visuals: { comets: true, crystals: true, guns: true, revolver: true }
    }
  };
  return structuredClone(preset[role] ?? preset.user);
}

function makeUser(handle, role = 'user') {
  const now = new Date().toISOString();
  return {
    handle,
    displayName: '',
    gameName: '',
    role,
    ...roleDefaults(role),
    keyHash: null,
    createdAt: now,
    updatedAt: now
  };
}

function cleanNickname(input, fallback) {
  const value = input && typeof input === 'object' ? input : {};
  const colors = Array.isArray(value.colors) ? value.colors : fallback.colors;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    mode: MODES.has(value.mode) ? value.mode : fallback.mode,
    colors: [0, 1].map(i => COLOR_RE.test(colors[i]) ? colors[i].toLowerCase() : fallback.colors[i]),
    glow: clamp(Number.isFinite(Number(value.glow)) ? Number(value.glow) : fallback.glow, 0, 30),
    speed: clamp(Number.isFinite(Number(value.speed)) ? Number(value.speed) : fallback.speed, 0.2, 3)
  };
}

function cleanVisuals(input, fallback) {
  const value = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(VISUALS.map(key => [key, typeof value[key] === 'boolean' ? value[key] : fallback[key]]));
}

function publicUser(user) {
  return {
    handle: user.handle,
    displayName: user.displayName,
    gameName: user.gameName,
    role: user.role,
    nickname: user.nickname,
    visuals: user.visuals,
    hasAccessKey: Boolean(user.keyHash),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

class Store {
  constructor(dataDir, ownerHandle, bootstrapKey) {
    this.dataDir = dataDir;
    this.usersFile = path.join(dataDir, 'users.json');
    this.privateFile = path.join(dataDir, 'private.json');
    fs.mkdirSync(dataDir, { recursive: true });
    const usersData = this.read(this.usersFile, { version: 1, users: {} });
    this.users = usersData.users ?? {};
    const existingPrivate = this.read(this.privateFile, {});
    this.private = {
      pepper: existingPrivate.pepper || randomKey(),
      bootstrapKey: bootstrapKey || existingPrivate.bootstrapKey || randomKey()
    };
    this.createdBootstrapKey = !existingPrivate.bootstrapKey;
    if (!this.users[ownerHandle]) this.users[ownerHandle] = makeUser(ownerHandle, 'creator');
    this.users[ownerHandle].role = 'creator';
    this.save();
  }

  read(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
  }

  write(file, value) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  save() {
    this.write(this.usersFile, { version: 1, users: this.users });
    this.write(this.privateFile, this.private);
  }

  ensure(handle) {
    if (!this.users[handle]) {
      this.users[handle] = makeUser(handle);
      this.save();
    }
    return this.users[handle];
  }
}

function json(res, status, data, origin) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {})
  });
  res.end(body);
}

function allowedOrigin(origin) {
  if (!origin) return '';
  return origin; // Разрешаем ВСЕ адреса, чтобы не было ошибок CORS
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw Object.assign(new Error('Слишком большой запрос'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Некорректный JSON'), { status: 400 }); }
}

export function createLunacyServer(options = {}) {
  const ownerHandle = normalizeHandle(options.ownerHandle || process.env.OWNER_HANDLE || 'cleverok');
  if (!HANDLE_RE.test(ownerHandle)) throw new Error('OWNER_HANDLE должен содержать 2–40 латинских букв, цифр, _ или -');
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
  
  const bootstrapKey = options.bootstrapKey || process.env.BOOTSTRAP_KEY || process.env.OWNER_BOOTSTRAP_KEY;
  
  const store = new Store(dataDir, ownerHandle, bootstrapKey);
  const sessions = new Map();
  const presence = new Map();

  function sessionFor(req) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) return null;
    const session = sessions.get(match[1]);
    if (!session || Date.now() - session.createdAt > SESSION_MS) {
      sessions.delete(match[1]);
      return null;
    }
    session.token = match[1];
    return session;
  }

  function privileged(session, roles = ['creator', 'admin']) {
    if (!session?.authenticated) return false;
    const role = store.users[session.handle]?.role;
    return roles.includes(role);
  }

  function onlinePlayers() {
    const now = Date.now();
    return [...presence.values()]
      .filter(item => now - item.lastSeen <= ONLINE_MS)
      .map(item => {
        const user = store.users[item.handle];
        return { ...publicUser(user), online: true, lastSeen: new Date(item.lastSeen).toISOString(), clientVersion: item.clientVersion };
      });
  }

  function touchPresence(session, body) {
    const user = store.ensure(session.handle);
    const gameName = safeText(body.gameName, 24);
    const displayName = safeText(body.displayName, 32);
    let changed = false;
    if (gameName && user.gameName !== gameName) { user.gameName = gameName; changed = true; }
    if (displayName && user.displayName !== displayName) { user.displayName = displayName; changed = true; }
    if (changed) { user.updatedAt = new Date().toISOString(); store.save(); }
    presence.set(session.handle, {
      handle: session.handle,
      lastSeen: Date.now(),
      clientVersion: safeText(body.clientVersion, 12) || '1.0.0'
    });
    return user;
  }

  function sessionPayload(session, user) {
    return {
      token: session.token,
      authenticated: session.authenticated,
      user: publicUser(user),
      players: onlinePlayers(),
      serverTime: new Date().toISOString()
    };
  }

  function newSession(handle, authenticated) {
    const token = randomKey();
    sessions.set(token, { token, handle, authenticated, createdAt: Date.now() });
    return sessions.get(token);
  }

  const server = http.createServer(async (req, res) => {
    const origin = allowedOrigin(req.headers.origin);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        ...(req.headers['access-control-request-private-network'] === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
        'Access-Control-Max-Age': '600'
      });
      return res.end();
    }

    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.replace(/\/$/, '') || '/';

      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { ok: true, name: 'Lunacy', version: '1.0.0', online: onlinePlayers().length }, origin);
      }

      if (req.method === 'POST' && pathname === '/api/session/guest') {
        const body = await readBody(req);
        const handle = normalizeHandle(body.handle);
        if (!HANDLE_RE.test(handle)) return json(res, 400, { error: 'Укажите корректный @handle mope.io' }, origin);
        const user = store.ensure(handle);
        const session = newSession(handle, false);
        touchPresence(session, body);
        return json(res, 200, sessionPayload(session, user), origin);
      }

      if (req.method === 'POST' && pathname === '/api/session/login') {
        const body = await readBody(req);
        const handle = normalizeHandle(body.handle);
        const key = String(body.key ?? '');
        if (!HANDLE_RE.test(handle) || key.length < 12) return json(res, 400, { error: 'Некорректный handle или ключ' }, origin);
        const user = store.users[handle];
        if (!user) return json(res, 404, { error: 'Пользователь не найден' }, origin);
        const ownerKey = handle === ownerHandle && equalSecret(key, store.private.bootstrapKey);
        const userKey = user.keyHash && equalSecret(hashKey(key, store.private.pepper), user.keyHash);
        if (!ownerKey && !userKey) return json(res, 403, { error: 'Ключ не подходит' }, origin);
        const session = newSession(handle, true);
        touchPresence(session, body);
        return json(res, 200, sessionPayload(session, user), origin);
      }

      if (req.method === 'POST' && pathname === '/api/presence') {
        const session = sessionFor(req);
        if (!session) return json(res, 401, { error: 'Сессия истекла' }, origin);
        const body = await readBody(req);
        const user = touchPresence(session, body);
        return json(res, 200, sessionPayload(session, user), origin);
      }

      if (req.method === 'POST' && pathname === '/api/session/logout') {
        const session = sessionFor(req);
        if (session) { sessions.delete(session.token); presence.delete(session.handle); }
        return json(res, 200, { ok: true }, origin);
      }

      if (req.method === 'GET' && pathname === '/api/admin/users') {
        const session = sessionFor(req);
        if (!privileged(session)) return json(res, 403, { error: 'Нужен подтверждённый admin или creator' }, origin);
        const players = new Map(onlinePlayers().map(player => [player.handle, player]));
        const users = Object.values(store.users).map(user => ({
          ...publicUser(user),
          online: players.has(user.handle),
          lastSeen: players.get(user.handle)?.lastSeen ?? null,
          clientVersion: players.get(user.handle)?.clientVersion ?? null
        })).sort((a, b) => Number(b.online) - Number(a.online) || a.handle.localeCompare(b.handle));
        return json(res, 200, { users }, origin);
      }

      const adminMatch = /^\/api\/admin\/users\/([a-zA-Z0-9_-]{2,40})(\/key)?$/.exec(pathname);
      if (adminMatch && req.method === 'PUT' && !adminMatch[2]) {
        const session = sessionFor(req);
        if (!privileged(session)) return json(res, 403, { error: 'Недостаточно прав' }, origin);
        const actor = store.users[session.handle];
        const handle = normalizeHandle(adminMatch[1]);
        const body = await readBody(req);
        const target = store.ensure(handle);
        if (actor.role !== 'creator' && (target.role === 'admin' || target.role === 'creator')) {
          return json(res, 403, { error: 'Admin не может изменять admin или creator' }, origin);
        }
        if (body.role !== undefined) {
          if (!ROLES.has(body.role)) return json(res, 400, { error: 'Неизвестная роль' }, origin);
          if (actor.role !== 'creator' && !['user', 'tester'].includes(body.role)) {
            return json(res, 403, { error: 'Admin может выдавать только user и tester' }, origin);
          }
          target.role = body.role;
        }
        if (body.displayName !== undefined) target.displayName = safeText(body.displayName, 32);
        if (body.gameName !== undefined) target.gameName = safeText(body.gameName, 24);
        target.nickname = cleanNickname(body.nickname, target.nickname);
        target.visuals = cleanVisuals(body.visuals, target.visuals);
        target.updatedAt = new Date().toISOString();
        store.save();
        return json(res, 200, { user: publicUser(target) }, origin);
      }

      if (adminMatch && req.method === 'POST' && adminMatch[2] === '/key') {
        const session = sessionFor(req);
        if (!privileged(session)) return json(res, 403, { error: 'Недостаточно прав' }, origin);
        const actor = store.users[session.handle];
        const target = store.ensure(normalizeHandle(adminMatch[1]));
        if (actor.role !== 'creator' && ['admin', 'creator'].includes(target.role)) {
          return json(res, 403, { error: 'Admin не может создать ключ для этой роли' }, origin);
        }
        const key = `lun_${randomKey()}`;
        target.keyHash = hashKey(key, store.private.pepper);
        target.updatedAt = new Date().toISOString();
        store.save();
        return json(res, 200, { key, handle: target.handle, notice: 'Ключ показан один раз.' }, origin);
      }

      return json(res, 404, { error: 'Маршрут не найден' }, origin);
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error('[lunacy]', error);
      return json(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : error.message }, origin);
    }
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) if (now - session.createdAt > SESSION_MS) sessions.delete(token);
    for (const [handle, item] of presence) if (now - item.lastSeen > ONLINE_MS * 4) presence.delete(handle);
  }, 60_000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  server.lunacy = { store, ownerHandle };
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const server = createLunacyServer();
  const port = Number(process.env.PORT) || 8787;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Lunacy API: http://0.0.0.0:${port}`);
    console.log(`Владелец: @${server.lunacy.ownerHandle}`);
    if (server.lunacy.store.createdBootstrapKey) {
      console.log(`Ключ первого входа владельца: ${server.lunacy.store.private.bootstrapKey}`);
    }
  });
}