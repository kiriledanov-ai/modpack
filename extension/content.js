(() => {
  'use strict';

  const VERSION = globalThis.LUNACY_DEFAULT_CONFIG?.clientVersion || '1.0.0';
  const SETTINGS_KEY = 'lunacy.settings.v1';
  const POSITION_KEY = 'lunacy.position.v1';
  const TOKEN_PREFIX = 'lunacy.token.v1:';
  const DEFAULT_SETTINGS = {
    zoom: 0.35,
    renderRange: 1.25,
    effectFps: 30,
    dprCap: 1.5,
    nicknames: true,
    effects: { comets: true, crystals: true, guns: true, revolver: true }
  };
  const DEFAULT_NICK = { enabled: true, mode: 'rainbow', colors: ['#2cc9ff', '#ff4f9a'], glow: 12, speed: 1 };
  const DEFAULT_VISUALS = { comets: true, crystals: true, guns: true, revolver: true };
  const ROLE_NAMES = { user: 'USER', tester: 'TESTER', admin: 'ADMIN', creator: 'СОЗДАТЕЛЬ' };

  let settings = loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
  settings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    effects: { ...DEFAULT_SETTINGS.effects, ...(settings.effects || {}) }
  };
  let serverUrl = globalThis.LUNACY_DEFAULT_CONFIG?.serverUrl || 'https://modpackcleva.onrender.com';
  let manualHandle = '';
  let detectedHandle = '';
  let detectedDisplayName = '';
  let gameName = '';
  let session = null;
  let currentUser = null;
  let players = [];
  let adminUsers = [];
  let root, panel, launcher, canvas, ctx;
  let activeView = 'mod';
  let networkBusy = false;
  let networkTimer = 0;
  let adminTimer = 0;
  let toastTimer = 0;
  let animationFrame = 0;
  let lastEffectFrame = 0;
  let lastStatusSync = 0;
  let hiddenNames = new Set();
  let inFlightConfig = 0;

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || structuredClone(fallback); }
    catch { return structuredClone(fallback); }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function normalizeHandle(value) {
    return String(value ?? '').trim().replace(/^@+/, '').toLowerCase();
  }

  function activeHandle() {
    return normalizeHandle(manualHandle || detectedHandle);
  }

  function tokenKey(handle = activeHandle()) {
    return `${TOKEN_PREFIX}${serverUrl}:${handle}`;
  }

  function toast(message, error = false) {
    if (!root) return;
    clearTimeout(toastTimer);
    root.querySelector('.lunacy-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'lunacy-toast';
    if (error) node.style.borderColor = 'var(--ln-pink)';
    node.textContent = message;
    root.appendChild(node);
    toastTimer = setTimeout(() => node.remove(), 2800);
  }

  function buildUI() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'lunacy-root';
    root.innerHTML = `
      <canvas id="lunacy-canvas" aria-hidden="true"></canvas>
      <section class="lunacy-panel" aria-label="Lunacy HUD">
        <header class="lunacy-head lunacy-drag">
          <div class="lunacy-mark" aria-hidden="true"></div>
          <div class="lunacy-brand">
            <div class="lunacy-title">Lunacy</div>
            <div class="lunacy-subtitle">ONLINE MODPACK · N — HUD</div>
          </div>
          <button class="lunacy-icon-button" data-action="hide" title="Скрыть HUD (N)" aria-label="Скрыть HUD">×</button>
        </header>
        <div class="lunacy-statusline">
          <span class="lunacy-dot"></span><span class="lunacy-connection">ЛОКАЛЬНО</span>
          <span class="lunacy-role">USER</span>
        </div>
        <nav class="lunacy-tabs" aria-label="Разделы">
          <button class="lunacy-tab active" data-view="mod">Мод</button>
          <button class="lunacy-tab" data-view="visual">Визуал</button>
          <button class="lunacy-tab" data-view="online">Онлайн <span class="lunacy-online-count">0</span></button>
          <button class="lunacy-tab" data-view="admin" hidden>Админ</button>
        </nav>
        <div class="lunacy-body">
          <div class="lunacy-view" data-view-panel="mod">
            <div class="lunacy-section">
              <div class="lunacy-label-row"><span class="lunacy-label">Большой зум</span><span class="lunacy-value" id="lunacy-zoom-value">2.9×</span></div>
              <input class="lunacy-range" id="lunacy-zoom" type="range" min="0.04" max="1" step="0.01" aria-label="Зум">
              <p class="lunacy-hint">Колесо мыши тоже работает. Минимум 0.04 — до 25× отдаления.</p>
            </div>
            <div class="lunacy-section">
              <div class="lunacy-label-row"><span class="lunacy-label">Рендер зума</span><span class="lunacy-value" id="lunacy-render-value">125%</span></div>
              <input class="lunacy-range" id="lunacy-render" type="range" min="1" max="3" step="0.05" aria-label="Дальность рендера">
              <p class="lunacy-hint">Расширяет видимую область клиента. Объекты, которых сервер вообще не прислал, отрисовать невозможно.</p>
            </div>
            <div class="lunacy-section lunacy-grid">
              <label class="lunacy-field"><span>FPS визуалов</span><select class="lunacy-select" id="lunacy-fps"><option value="20">20 — экономно</option><option value="30">30 — оптимально</option><option value="60">60 — плавно</option></select></label>
              <label class="lunacy-field"><span>Чёткость canvas</span><select class="lunacy-select" id="lunacy-dpr"><option value="1">1× — экономно</option><option value="1.5">1.5× — оптимально</option><option value="2">2× — чётко</option></select></label>
            </div>
            <div class="lunacy-section">
              <div class="lunacy-label-row"><span class="lunacy-label">Твой ник</span><span class="lunacy-small">ONLINE STYLE</span></div>
              <div class="lunacy-preview"><span class="lunacy-nick rainbow" id="lunacy-nick-preview">LUNACY</span></div>
            </div>
          </div>
          <div class="lunacy-view" data-view-panel="visual" hidden>
            <div class="lunacy-section">
              <div class="lunacy-label-row"><span class="lunacy-label">Визуалы возле животного</span><span class="lunacy-small">LOCAL + SERVER</span></div>
              <div class="lunacy-checks">
                <label class="lunacy-check"><input type="checkbox" data-effect="comets">Кометы</label>
                <label class="lunacy-check"><input type="checkbox" data-effect="crystals">Кристаллы</label>
                <label class="lunacy-check"><input type="checkbox" data-effect="guns">Пистолетики</label>
                <label class="lunacy-check"><input type="checkbox" data-effect="revolver">Револьвер</label>
              </div>
              <p class="lunacy-hint">Это только клиентская косметика: урон, выстрелы и игровую механику Lunacy не меняет.</p>
            </div>
            <div class="lunacy-section">
              <label class="lunacy-check"><input type="checkbox" id="lunacy-nicknames">Цветные ники игроков Lunacy</label>
              <p class="lunacy-hint">Сопоставление с игроками идёт по игровому имени. Другие пользователи увидят твой стиль после следующего heartbeat.</p>
            </div>
          </div>
          <div class="lunacy-view" data-view-panel="online" hidden>
            <div class="lunacy-section">
              <label class="lunacy-field"><span>Твой @handle mope.io</span><input class="lunacy-input" id="lunacy-handle" maxlength="40" placeholder="user-a1a559ff38d09716" spellcheck="false"></label>
              <button class="lunacy-button primary" data-action="connect" style="width:100%">Подключиться к Lunacy</button>
              <p class="lunacy-hint" id="lunacy-identity-hint">Handle обычно подхватывается из профиля автоматически.</p>
            </div>
            <div class="lunacy-section">
              <div class="lunacy-label-row"><span class="lunacy-label">Сейчас в модпаке</span><button class="lunacy-button" data-action="refresh">Обновить</button></div>
              <div class="lunacy-list" id="lunacy-online-list"><div class="lunacy-empty">Нет данных об онлайне</div></div>
            </div>
          </div>
          <div class="lunacy-view" data-view-panel="admin" hidden>
            <div class="lunacy-section" id="lunacy-admin-login">
              <div class="lunacy-label-row"><span class="lunacy-label">Вход с правами</span><span class="lunacy-small">SECURE KEY</span></div>
              <p class="lunacy-hint">Для @cleverok используйте ключ первого входа из server/data/private.json. Для остальных — персональный ключ от создателя.</p>
              <label class="lunacy-field" style="margin-top:10px"><span>Ключ доступа</span><input class="lunacy-input" id="lunacy-admin-key" type="password" placeholder="Ключ владельца или lun_…" autocomplete="off"></label>
              <button class="lunacy-button primary" data-action="admin-login" style="width:100%">Подтвердить права</button>
            </div>
            <div id="lunacy-admin-manager" hidden>
              <div class="lunacy-section">
                <div class="lunacy-label-row"><span class="lunacy-label">Выдача по @handle</span><button class="lunacy-button" data-action="admin-refresh">Список</button></div>
                <label class="lunacy-field"><span>Handle пользователя</span><input class="lunacy-input" id="lunacy-target" placeholder="@user-…" spellcheck="false"></label>
                <div class="lunacy-grid">
                  <label class="lunacy-field"><span>Роль</span><select class="lunacy-select" id="lunacy-target-role"><option value="user">User</option><option value="tester">Tester</option><option value="admin">Admin</option><option value="creator">Creator</option></select></label>
                  <label class="lunacy-field"><span>Игровой ник</span><input class="lunacy-input" id="lunacy-target-game" maxlength="24" placeholder="Ник в игре"></label>
                </div>
                <div class="lunacy-grid">
                  <label class="lunacy-field"><span>Стиль</span><select class="lunacy-select" id="lunacy-target-mode"><option value="solid">Один цвет</option><option value="gradient">Градиент</option><option value="rainbow">Переливание</option><option value="pulse">Пульс</option></select></label>
                  <label class="lunacy-field"><span>Свечение 0–30</span><input class="lunacy-input" id="lunacy-target-glow" type="number" min="0" max="30" value="14"></label>
                </div>
                <div class="lunacy-grid">
                  <label class="lunacy-field"><span>Цвет 1</span><input class="lunacy-color" id="lunacy-target-color1" type="color" value="#2cc9ff"></label>
                  <label class="lunacy-field"><span>Цвет 2</span><input class="lunacy-color" id="lunacy-target-color2" type="color" value="#ff4f9a"></label>
                </div>
                <label class="lunacy-check"><input type="checkbox" id="lunacy-target-nick" checked>Цветной никнейм включён</label>
                <div class="lunacy-checks" style="margin-top:8px">
                  <label class="lunacy-check"><input type="checkbox" data-target-visual="comets" checked>Кометы</label>
                  <label class="lunacy-check"><input type="checkbox" data-target-visual="crystals" checked>Кристаллы</label>
                  <label class="lunacy-check"><input type="checkbox" data-target-visual="guns" checked>Пистолетики</label>
                  <label class="lunacy-check"><input type="checkbox" data-target-visual="revolver" checked>Револьвер</label>
                </div>
                <div class="lunacy-actions">
                  <button class="lunacy-button primary" data-action="admin-save">Выдать</button>
                  <button class="lunacy-button" data-action="admin-key">Создать ключ</button>
                </div>
                <div class="lunacy-key" id="lunacy-key-result"><textarea class="lunacy-textarea" id="lunacy-generated-key" readonly></textarea><button class="lunacy-button" data-action="copy-key" style="width:100%;margin-top:6px">Копировать ключ</button></div>
              </div>
              <div class="lunacy-section">
                <div class="lunacy-label-row"><span class="lunacy-label">Пользователи</span><span class="lunacy-small" id="lunacy-admin-count">0</span></div>
                <div class="lunacy-list" id="lunacy-admin-list"><div class="lunacy-empty">Загрузка…</div></div>
                <div class="lunacy-actions"><button class="lunacy-button danger" data-action="admin-logout">Выйти из прав</button></div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <button class="lunacy-launcher" data-action="show" title="Открыть Lunacy (N)" aria-label="Открыть Lunacy" hidden>L</button>`;
    document.documentElement.appendChild(root);
    panel = root.querySelector('.lunacy-panel');
    launcher = root.querySelector('.lunacy-launcher');
    canvas = root.querySelector('#lunacy-canvas');
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    restorePosition();
    bindUI();
    syncControls();
    resizeCanvas();
    renderAll();
    animationFrame = requestAnimationFrame(drawFrame);
  }

  function bindUI() {
    root.addEventListener('click', event => {
      const view = event.target.closest('[data-view]')?.dataset.view;
      if (view) switchView(view);
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action) handleAction(action);
      const userButton = event.target.closest('[data-select-user]');
      if (userButton) selectAdminUser(userButton.dataset.selectUser);
    });

    root.querySelector('#lunacy-zoom').addEventListener('input', event => {
      settings.zoom = Number(event.target.value);
      applyGameSettings();
      syncControls();
      saveSettings();
    });
    root.querySelector('#lunacy-render').addEventListener('input', event => {
      settings.renderRange = Number(event.target.value);
      applyGameSettings();
      syncControls();
      saveSettings();
    });
    root.querySelector('#lunacy-fps').addEventListener('change', event => { settings.effectFps = Number(event.target.value); saveSettings(); });
    root.querySelector('#lunacy-dpr').addEventListener('change', event => { settings.dprCap = Number(event.target.value); resizeCanvas(); saveSettings(); });
    root.querySelectorAll('[data-effect]').forEach(input => input.addEventListener('change', () => {
      settings.effects[input.dataset.effect] = input.checked;
      saveSettings();
    }));
    root.querySelector('#lunacy-nicknames').addEventListener('change', event => {
      settings.nicknames = event.target.checked;
      if (!settings.nicknames) restoreNames();
      saveSettings();
    });
    root.querySelector('#lunacy-handle').addEventListener('change', event => {
      detectedHandle = normalizeHandle(event.target.value);
    });

    const drag = root.querySelector('.lunacy-drag');
    drag.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      drag.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const left = Math.min(innerWidth - 70, Math.max(0, moveEvent.clientX - offsetX));
        const top = Math.min(innerHeight - 55, Math.max(0, moveEvent.clientY - offsetY));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
      };
      const up = () => {
        drag.removeEventListener('pointermove', move);
        drag.removeEventListener('pointerup', up);
        drag.removeEventListener('pointercancel', up);
        try { localStorage.setItem(POSITION_KEY, JSON.stringify({ left: panel.style.left, top: panel.style.top })); } catch {}
      };
      drag.addEventListener('pointermove', move);
      drag.addEventListener('pointerup', up);
      drag.addEventListener('pointercancel', up);
    });
  }

  function handleAction(action) {
    if (action === 'hide') toggleHUD(false);
    if (action === 'show') toggleHUD(true);
    if (action === 'connect') { detectedHandle = normalizeHandle(root.querySelector('#lunacy-handle').value); resetSession(); connectOnline(true); }
    if (action === 'refresh') connectOnline(true);
    if (action === 'admin-login') adminLogin();
    if (action === 'admin-refresh') loadAdminUsers();
    if (action === 'admin-save') saveAdminUser();
    if (action === 'admin-key') generateAdminKey();
    if (action === 'copy-key') copyGeneratedKey();
    if (action === 'admin-logout') adminLogout();
  }

  function switchView(view) {
    activeView = view;
    root.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    root.querySelectorAll('[data-view-panel]').forEach(node => { node.hidden = node.dataset.viewPanel !== view; });
    if (view === 'admin' && session?.authenticated) loadAdminUsers();
  }

  function toggleHUD(show = panel.hidden) {
    panel.hidden = !show;
    launcher.hidden = show;
  }

  function restorePosition() {
    const position = loadJSON(POSITION_KEY, null);
    if (!position) return;
    panel.style.left = position.left;
    panel.style.top = position.top;
    panel.style.right = 'auto';
  }

  function syncControls() {
    if (!root) return;
    root.querySelector('#lunacy-zoom').value = settings.zoom;
    root.querySelector('#lunacy-render').value = settings.renderRange;
    root.querySelector('#lunacy-fps').value = String(settings.effectFps);
    root.querySelector('#lunacy-dpr').value = String(settings.dprCap);
    root.querySelector('#lunacy-zoom-value').textContent = `${(1 / settings.zoom).toFixed(settings.zoom < 0.1 ? 1 : 1)}×`;
    root.querySelector('#lunacy-render-value').textContent = `${Math.round(settings.renderRange * 100)}%`;
    root.querySelectorAll('[data-effect]').forEach(input => {
      input.checked = Boolean(settings.effects[input.dataset.effect]);
      input.disabled = Boolean(currentUser && !currentUser.visuals?.[input.dataset.effect]);
      input.title = input.disabled ? 'Этот визуал отключён для вашей роли на сервере' : '';
    });
    root.querySelector('#lunacy-nicknames').checked = settings.nicknames;
    const preview = root.querySelector('#lunacy-nick-preview');
    const nick = currentUser?.nickname || DEFAULT_NICK;
    preview.textContent = currentUser?.gameName || gameName || currentUser?.displayName || activeHandle() || 'LUNACY';
    preview.className = `lunacy-nick ${nick.mode}`;
    preview.style.color = nick.mode === 'rainbow' ? 'transparent' : (nick.colors?.[0] || '#2cc9ff');
    preview.style.textShadow = nick.mode === 'rainbow' ? 'none' : `0 0 ${nick.glow || 0}px ${nick.colors?.[0] || '#2cc9ff'}`;
    preview.style.animationDuration = `${2.8 / (nick.speed || 1)}s`;
    if (nick.mode === 'gradient') {
      preview.style.background = `linear-gradient(90deg,${nick.colors[0]},${nick.colors[1]})`;
      preview.style.webkitBackgroundClip = 'text';
      preview.style.backgroundClip = 'text';
      preview.style.color = 'transparent';
    } else {
      preview.style.background = '';
      preview.style.webkitBackgroundClip = '';
      preview.style.backgroundClip = '';
    }
  }

  function renderAll() {
    if (!root) return;
    const role = currentUser?.role || 'user';
    root.querySelector('.lunacy-role').textContent = ROLE_NAMES[role] || role.toUpperCase();
    const adminAllowed = ['admin', 'creator'].includes(role);
    root.querySelector('[data-view="admin"]').hidden = !adminAllowed;
    if (!adminAllowed && activeView === 'admin') switchView('mod');
    const connected = Boolean(session && currentUser);
    const dot = root.querySelector('.lunacy-dot');
    dot.className = `lunacy-dot ${connected ? 'online' : networkBusy ? '' : 'error'}`;
    root.querySelector('.lunacy-connection').textContent = networkBusy ? 'ПОДКЛЮЧЕНИЕ' : connected ? 'ONLINE' : 'ЛОКАЛЬНО';
    root.querySelector('.lunacy-online-count').textContent = String(players.length);
    if (document.activeElement !== root.querySelector('#lunacy-handle')) root.querySelector('#lunacy-handle').value = activeHandle();
    renderOnline();
    renderAdmin();
    syncControls();
  }

  function playerRow(user, selectable = false) {
    const name = user.gameName || user.displayName || `@${user.handle}`;
    const role = ROLE_NAMES[user.role] || user.role;
    const content = `<span class="lunacy-dot ${user.online === false ? '' : 'online'}"></span><span class="lunacy-userline"><strong>${escapeHTML(name)}</strong><span class="lunacy-badge">${escapeHTML(role)}</span></span><span class="lunacy-small">@${escapeHTML(user.handle)}</span>`;
    return selectable
      ? `<button class="lunacy-user" data-select-user="${escapeHTML(user.handle)}" type="button">${content}</button>`
      : `<div class="lunacy-user">${content}</div>`;
  }

  function renderOnline() {
    const list = root.querySelector('#lunacy-online-list');
    list.innerHTML = players.length ? players.map(user => playerRow(user)).join('') : '<div class="lunacy-empty">Пока никто не онлайн</div>';
  }

  function renderAdmin() {
    const authenticated = Boolean(session?.authenticated && ['admin', 'creator'].includes(currentUser?.role));
    root.querySelector('#lunacy-admin-login').hidden = authenticated;
    root.querySelector('#lunacy-admin-manager').hidden = !authenticated;
    if (!authenticated) return;
    const actorRole = currentUser.role;
    const roleSelect = root.querySelector('#lunacy-target-role');
    roleSelect.querySelector('[value="admin"]').disabled = actorRole !== 'creator';
    roleSelect.querySelector('[value="creator"]').disabled = actorRole !== 'creator';
    root.querySelector('#lunacy-admin-count').textContent = `${adminUsers.length} · ${adminUsers.filter(user => user.online).length} online`;
    root.querySelector('#lunacy-admin-list').innerHTML = adminUsers.length ? adminUsers.map(user => playerRow(user, true)).join('') : '<div class="lunacy-empty">Нажмите «Список»</div>';
  }

  async function api(route, { method = 'GET', body, token } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch(`${serverUrl}${route}`, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }

  function identityBody() {
    let storedName = '';
    try { storedName = localStorage.getItem('name') || ''; } catch {}
    return { handle: activeHandle(), gameName: gameName || storedName, displayName: detectedDisplayName, clientVersion: VERSION };
  }

  function acceptSession(data) {
    session = { token: data.token, authenticated: data.authenticated };
    currentUser = data.user;
    players = data.players || [];
    try { localStorage.setItem(tokenKey(), data.token); } catch {}
    renderAll();
  }

  async function connectOnline(notify = false) {
    if (!root || networkBusy) return;
    const handle = activeHandle();
    if (!handle) {
      renderAll();
      if (notify) toast('Укажите @handle во вкладке «Онлайн»', true);
      return;
    }
    networkBusy = true;
    renderAll();
    const configId = ++inFlightConfig;
    try {
      let token = session?.token;
      if (!token) {
        try { token = localStorage.getItem(tokenKey(handle)); } catch {}
      }
      let data;
      if (token) {
        try { data = await api('/api/presence', { method: 'POST', token, body: identityBody() }); }
        catch (error) {
          if (error.status !== 401) throw error;
          data = await api('/api/session/guest', { method: 'POST', body: identityBody() });
        }
      } else data = await api('/api/session/guest', { method: 'POST', body: identityBody() });
      if (configId !== inFlightConfig) return;
      acceptSession(data);
      if (notify) toast(`Lunacy online: @${handle}`);
    } catch (error) {
      if (configId !== inFlightConfig) return;
      session = null;
      currentUser = null;
      players = [];
      if (notify) toast(`Сервер недоступен: ${error.message}`, true);
    } finally {
      if (configId === inFlightConfig) { networkBusy = false; renderAll(); }
    }
  }

  function resetSession() {
    session = null;
    currentUser = null;
    players = [];
    adminUsers = [];
    networkBusy = false;
    inFlightConfig++;
  }

  async function adminLogin() {
    const key = root.querySelector('#lunacy-admin-key').value.trim();
    const handle = activeHandle();
    if (!handle || !key) return toast('Нужны @handle и ключ', true);
    networkBusy = true;
    renderAll();
    try {
      const data = await api('/api/session/login', { method: 'POST', body: { ...identityBody(), handle, key } });
      acceptSession(data);
      root.querySelector('#lunacy-admin-key').value = '';
      toast(`Права подтверждены: ${ROLE_NAMES[currentUser.role]}`);
      await loadAdminUsers();
    } catch (error) { toast(error.message, true); }
    finally { networkBusy = false; renderAll(); }
  }

  async function adminLogout() {
    if (session?.token) {
      try { await api('/api/session/logout', { method: 'POST', token: session.token }); } catch {}
    }
    try { localStorage.removeItem(tokenKey()); } catch {}
    resetSession();
    await connectOnline();
    toast('Админ-сессия завершена');
  }

  async function loadAdminUsers() {
    if (!session?.authenticated) return;
    try {
      const data = await api('/api/admin/users', { token: session.token });
      adminUsers = data.users || [];
      renderAdmin();
    } catch (error) { toast(error.message, true); }
  }

  function selectAdminUser(handle) {
    const user = adminUsers.find(item => item.handle === handle);
    if (!user) return;
    root.querySelector('#lunacy-target').value = user.handle;
    root.querySelector('#lunacy-target-role').value = user.role;
    root.querySelector('#lunacy-target-game').value = user.gameName || '';
    root.querySelector('#lunacy-target-mode').value = user.nickname.mode;
    root.querySelector('#lunacy-target-glow').value = user.nickname.glow;
    root.querySelector('#lunacy-target-color1').value = user.nickname.colors[0];
    root.querySelector('#lunacy-target-color2').value = user.nickname.colors[1];
    root.querySelector('#lunacy-target-nick').checked = user.nickname.enabled;
    root.querySelectorAll('[data-target-visual]').forEach(input => { input.checked = Boolean(user.visuals[input.dataset.targetVisual]); });
    root.querySelector('#lunacy-key-result').classList.remove('visible');
  }

  function adminPayload() {
    const visuals = {};
    root.querySelectorAll('[data-target-visual]').forEach(input => { visuals[input.dataset.targetVisual] = input.checked; });
    return {
      role: root.querySelector('#lunacy-target-role').value,
      gameName: root.querySelector('#lunacy-target-game').value.trim(),
      nickname: {
        enabled: root.querySelector('#lunacy-target-nick').checked,
        mode: root.querySelector('#lunacy-target-mode').value,
        glow: Number(root.querySelector('#lunacy-target-glow').value),
        speed: 1,
        colors: [root.querySelector('#lunacy-target-color1').value, root.querySelector('#lunacy-target-color2').value]
      },
      visuals
    };
  }

  function targetHandle() {
    return normalizeHandle(root.querySelector('#lunacy-target').value);
  }

  async function saveAdminUser() {
    const handle = targetHandle();
    if (!/^[a-zA-Z0-9_-]{2,40}$/.test(handle)) return toast('Некорректный @handle', true);
    try {
      await api(`/api/admin/users/${encodeURIComponent(handle)}`, { method: 'PUT', token: session.token, body: adminPayload() });
      toast(`Выдано для @${handle}`);
      await loadAdminUsers();
      await connectOnline();
    } catch (error) { toast(error.message, true); }
  }

  async function generateAdminKey() {
    const handle = targetHandle();
    if (!/^[a-zA-Z0-9_-]{2,40}$/.test(handle)) return toast('Сначала укажите @handle', true);
    try {
      const data = await api(`/api/admin/users/${encodeURIComponent(handle)}/key`, { method: 'POST', token: session.token });
      root.querySelector('#lunacy-generated-key').value = data.key;
      root.querySelector('#lunacy-key-result').classList.add('visible');
      toast('Ключ создан. Старый ключ больше не действует.');
    } catch (error) { toast(error.message, true); }
  }

  async function copyGeneratedKey() {
    const field = root.querySelector('#lunacy-generated-key');
    try { await navigator.clipboard.writeText(field.value); toast('Ключ скопирован'); }
    catch { field.select(); document.execCommand('copy'); toast('Ключ выделен для копирования'); }
  }

  function applyGameSettings() {
    globalThis.__LUNACY_ZOOM_LIMITS__ = { min: 0.04, max: 2 };
    globalThis.__LUNACY_RENDER_RANGE__ = settings.renderRange;
    const mope = globalThis.__LUNACY_MOPE__;
    if (mope?.settings?.rendering) mope.settings.rendering.zoom = settings.zoom;
  }

  function detectIdentity() {
    const before = `${detectedHandle}|${detectedDisplayName}|${gameName}`;
    const mope = globalThis.__LUNACY_MOPE__;
    const profile = mope?.profile?.profile;
    const handle = normalizeHandle(profile?.publicProfile?.handle || profile?.handle);
    if (handle) detectedHandle = handle;
    detectedDisplayName = profile?.displayName || detectedDisplayName;
    let name = '';
    try { name = mope?.account?.username || localStorage.getItem('name') || ''; } catch { name = mope?.account?.username || ''; }
    if (name) gameName = name;
    if (currentUser && currentUser.handle === activeHandle() && name && currentUser.gameName !== name) currentUser.gameName = name;
    if (root && before !== `${detectedHandle}|${detectedDisplayName}|${gameName}`) renderAll();
  }

  function restoreNames() {
    for (const entity of hiddenNames) {
      try { if (entity.name) entity.name.visible = true; } catch {}
    }
    hiddenNames.clear();
  }

  function resizeCanvas() {
    if (!canvas) return;
    const ratio = Math.min(devicePixelRatio || 1, Number(settings.dprCap) || 1.5);
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  }

  function project(entity, mope) {
    const gameCanvas = mope.game.loop.canvas;
    if (!gameCanvas?.width || !gameCanvas?.height) return null;
    const point = mope.game.camera.zz(entity.position);
    const sx = canvas.width / gameCanvas.width;
    const sy = canvas.height / gameCanvas.height;
    return { x: point.x * sx, y: point.y * sy, scale: (sx + sy) / 2 };
  }

  function effectiveVisual(key) {
    return Boolean(settings.effects[key] && (currentUser?.visuals?.[key] ?? DEFAULT_VISUALS[key]));
  }

  function drawFrame(now) {
    animationFrame = requestAnimationFrame(drawFrame);
    const interval = 1000 / Math.max(1, settings.effectFps);
    if (document.hidden || now - lastEffectFrame < interval) return;
    lastEffectFrame = now;
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    detectIdentity();
    const mope = globalThis.__LUNACY_MOPE__;
    const player = mope?.game?.player;
    if (!player?.position || !mope.game.camera) { restoreNames(); return; }

    if (now - lastStatusSync > 500) {
      lastStatusSync = now;
      const liveZoom = mope.settings?.rendering?.zoom;
      if (Number.isFinite(liveZoom) && Math.abs(liveZoom - settings.zoom) > 0.005 && document.activeElement !== root.querySelector('#lunacy-zoom')) {
        settings.zoom = Math.min(1, Math.max(0.04, liveZoom));
        syncControls();
      }
    }

    const center = project(player, mope);
    if (!center) return;
    const zoom = Math.max(0.02, mope.game.camera.zoom || 1);
    const radius = Math.min(190, Math.max(34, (player.size?.x || 60) * zoom * center.scale * 0.68));
    const time = now / 1000;
    if (effectiveVisual('comets')) drawComets(center.x, center.y, radius, time);
    if (effectiveVisual('crystals')) drawCrystals(center.x, center.y, radius * 1.13, time);
    if (effectiveVisual('guns')) drawGuns(center.x, center.y, radius * 1.3, time);
    if (effectiveVisual('revolver')) drawRevolver(center.x, center.y, radius, time);
    if (settings.nicknames) drawNicknames(mope, now);
    else restoreNames();
  }

  function drawComets(x, y, radius, time) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const angle = time * (0.75 + i * 0.035) + i * Math.PI * 0.4;
      const orbit = radius * (0.9 + (i % 2) * 0.18);
      const px = x + Math.cos(angle) * orbit;
      const py = y + Math.sin(angle) * orbit * 0.58;
      const tail = 18 + i * 2;
      const tx = px - Math.cos(angle) * tail;
      const ty = py - Math.sin(angle) * tail * 0.58;
      const gradient = ctx.createLinearGradient(tx, ty, px, py);
      gradient.addColorStop(0, 'rgba(44,201,255,0)');
      gradient.addColorStop(1, i % 2 ? 'rgba(255,79,154,.8)' : 'rgba(44,201,255,.9)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = i % 2 ? '#ff4f9a' : '#2cc9ff';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawCrystals(x, y, radius, time) {
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const angle = -time * 0.48 + i * Math.PI / 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius * 0.62;
      const size = 7 + Math.sin(time * 2 + i) * 1.5;
      ctx.save(); ctx.translate(px, py); ctx.rotate(angle + time);
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = '#2cc9ff'; ctx.shadowBlur = 13;
      const gradient = ctx.createLinearGradient(-size, -size, size, size);
      gradient.addColorStop(0, '#e4e5f9'); gradient.addColorStop(.45, '#2cc9ff'); gradient.addColorStop(1, '#ff4f9a');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.moveTo(0, -size * 1.5); ctx.lineTo(size * .72, 0); ctx.lineTo(0, size * 1.5); ctx.lineTo(-size * .72, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e4e5f9aa'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(0, -size * 1.5); ctx.lineTo(0, size * 1.5); ctx.moveTo(-size * .72, 0); ctx.lineTo(size * .72, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function pistolPath(size) {
    ctx.beginPath();
    ctx.moveTo(-size * .9, -size * .3); ctx.lineTo(size * .95, -size * .3); ctx.lineTo(size * .95, size * .05);
    ctx.lineTo(size * .22, size * .05); ctx.lineTo(size * .05, size * .25); ctx.lineTo(-size * .05, size * .95);
    ctx.lineTo(-size * .55, size * .95); ctx.lineTo(-size * .48, size * .12); ctx.lineTo(-size * .9, size * .12); ctx.closePath();
  }

  function drawGuns(x, y, radius, time) {
    for (let i = 0; i < 2; i++) {
      const angle = time * .62 + i * Math.PI;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius * .65;
      ctx.save(); ctx.translate(px, py); ctx.rotate(angle + Math.PI / 2); ctx.scale(i ? -1 : 1, 1);
      ctx.shadowColor = '#f5d547'; ctx.shadowBlur = 9;
      pistolPath(9); ctx.fillStyle = '#f5d547'; ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#1b1f23'; ctx.fillRect(-6, -2, 10, 2);
      ctx.restore();
    }
  }

  function drawRevolver(x, y, radius, time) {
    const angle = -time * .38 + .4;
    const recoilPhase = (time % 3.2) / 3.2;
    const recoil = recoilPhase < .08 ? Math.sin(recoilPhase / .08 * Math.PI) * 8 : 0;
    const px = x + Math.cos(angle) * (radius * 1.48 + recoil);
    const py = y + Math.sin(angle) * radius * .72;
    const size = 12;
    ctx.save(); ctx.translate(px, py); ctx.rotate(angle + Math.PI / 2 - recoil * .025);
    ctx.shadowColor = '#ff4f9a'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#e4e5f9';
    ctx.fillRect(-size * .28, -size * 1.25, size * .56, size * 1.15);
    ctx.fillStyle = '#2cc9ff'; ctx.fillRect(-size * .18, -size * 1.42, size * .36, size * .28);
    ctx.beginPath(); ctx.arc(0, 0, size * .57, 0, Math.PI * 2); ctx.fillStyle = '#a8b0b8'; ctx.fill();
    ctx.save(); ctx.rotate(time * 4.5);
    ctx.fillStyle = '#1b1f23';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.beginPath(); ctx.arc(Math.cos(a) * size * .34, Math.sin(a) * size * .34, size * .1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#ff4f9a';
    ctx.beginPath(); ctx.moveTo(-size * .38, size * .35); ctx.lineTo(size * .35, size * .38); ctx.lineTo(size * .6, size * 1.25); ctx.lineTo(-size * .05, size * 1.25); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f5d547'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, size * .48, size * .36, 0, Math.PI); ctx.stroke();
    if (recoil > 2) {
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#f5d547';
      ctx.beginPath(); ctx.moveTo(0, -size * 1.5); ctx.lineTo(size * .45, -size * 2); ctx.lineTo(0, -size * 1.82); ctx.lineTo(-size * .45, -size * 2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function nicknameUsers() {
    const map = new Map();
    for (const user of players) if (user.gameName && user.nickname?.enabled) map.set(user.gameName.toLowerCase(), user);
    if (currentUser?.gameName && currentUser.nickname?.enabled) map.set(currentUser.gameName.toLowerCase(), currentUser);
    return map;
  }

  function drawNicknames(mope, now) {
    const users = nicknameUsers();
    if (!users.size || !mope.entities) { restoreNames(); return; }
    const currentHidden = new Set();
    let drawn = 0;
    for (const entity of mope.entities.values()) {
      if (drawn > 120 || typeof entity.lc !== 'string' || !entity.position) continue;
      const user = users.get(entity.lc.toLowerCase());
      if (!user) continue;
      const point = project(entity, mope);
      if (!point || point.x < -150 || point.y < -100 || point.x > canvas.width + 150 || point.y > canvas.height + 100) continue;
      const zoom = mope.game.camera.zoom || 1;
      const offset = Math.min(90, Math.max(17, (entity.size?.y || 50) * zoom * point.scale * .62 + 12));
      drawStyledName(user.gameName || entity.lc, point.x, point.y - offset, user.nickname, now, zoom);
      if (entity.name) { entity.name.visible = false; currentHidden.add(entity); }
      drawn++;
    }
    for (const entity of hiddenNames) if (!currentHidden.has(entity)) {
      try { entity.name.visible = true; } catch {}
    }
    hiddenNames = currentHidden;
  }

  function drawStyledName(text, x, y, nick, now, zoom) {
    const size = Math.min(22, Math.max(11, 12 * Math.sqrt(Math.max(.08, zoom))));
    ctx.save();
    ctx.font = `800 ${size}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const label = String(text).slice(0, 24);
    const width = ctx.measureText(label).width;
    const left = x - width / 2;
    const speed = nick.speed || 1;
    const glow = Math.min(30, nick.glow || 0);
    ctx.shadowBlur = glow;
    ctx.shadowColor = nick.colors?.[0] || '#2cc9ff';
    ctx.globalAlpha = nick.mode === 'pulse' ? .65 + Math.sin(now / 1000 * speed * 3) * .3 : 1;
    if (nick.mode === 'rainbow') {
      let cursor = left;
      for (let i = 0; i < label.length; i++) {
        const hue = (now / 8 * speed + i * 29) % 360;
        ctx.fillStyle = `hsl(${hue} 100% 67%)`;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fillText(label[i], cursor, y);
        cursor += ctx.measureText(label[i]).width;
      }
    } else {
      if (nick.mode === 'gradient') {
        const gradient = ctx.createLinearGradient(left, y, left + width, y);
        gradient.addColorStop(0, nick.colors[0]); gradient.addColorStop(1, nick.colors[1]);
        ctx.fillStyle = gradient;
      } else ctx.fillStyle = nick.colors?.[0] || '#ffffff';
      ctx.fillText(label, left, y);
    }
    ctx.restore();
  }

  function onConfig(event) {
    if (event.source !== window || event.data?.source !== 'lunacy-extension' || event.data?.type !== 'config') return;
    manualHandle = normalizeHandle(event.data.manualHandle);
    const nextServer = String(event.data.serverUrl || '').trim().replace(/\/+$/, '');
    if (nextServer && /^https?:\/\//i.test(nextServer) && nextServer !== serverUrl) {
      serverUrl = nextServer;
      resetSession();
      clearInterval(networkTimer);
      networkTimer = setInterval(() => connectOnline(), 20_000);
      connectOnline();
    }
    renderAll();
  }

  function start() {
    buildUI();
    applyGameSettings();
    window.addEventListener('resize', resizeCanvas, { passive: true });
    window.addEventListener('lunacy:engine-ready', () => { applyGameSettings(); detectIdentity(); });
    window.addEventListener('lunacy:patch-fallback', () => toast('Клиент mope.io обновился: зум временно в безопасном режиме', true));
    window.addEventListener('message', onConfig);
    document.addEventListener('keydown', event => {
      if (event.code !== 'KeyN' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
      event.preventDefault();
      toggleHUD();
    });
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (detectedHandle || !(node instanceof HTMLElement)) continue;
        const text = node.textContent || '';
        if (!text.includes('Profile details') && !text.includes('@user-')) continue;
        const match = text.match(/@([a-zA-Z0-9_-]{2,40})/);
        if (match) { detectedHandle = normalizeHandle(match[1]); renderAll(); connectOnline(); }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    networkTimer = setInterval(() => connectOnline(), 20_000);
    adminTimer = setInterval(() => { if (activeView === 'admin' && session?.authenticated) loadAdminUsers(); }, 12_000);
    setTimeout(() => { detectIdentity(); connectOnline(); }, 1200);
    setTimeout(() => { detectIdentity(); applyGameSettings(); connectOnline(); }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
