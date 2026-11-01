(() => {
  'use strict';
  const core = globalThis.LunacyPatchCore;
  let intercepted = false;

  globalThis.__LUNACY_ZOOM_CLAMP__ = value => {
    if (!Number.isFinite(value)) return 1;
    const limits = globalThis.__LUNACY_ZOOM_LIMITS__ || { min: 0.04, max: 2 };
    return Math.min(limits.max, Math.max(limits.min, value));
  };
  globalThis.__LUNACY_RENDER_RANGE__ = 1.25;
  globalThis.__LUNACY_PATCH_STATUS__ = 'waiting';

  async function fetchText(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }

  function restore(originalUrl) {
    globalThis.__LUNACY_PATCH_STATUS__ = 'fallback';
    const script = document.createElement('script');
    script.type = 'module';
    script.src = originalUrl;
    (document.head || document.documentElement).appendChild(script);
    dispatchEvent(new CustomEvent('lunacy:patch-fallback'));
  }

  async function bootstrap(originalScript) {
    const entryUrl = originalScript.src;
    originalScript.type = 'lunacy/disabled';
    originalScript.removeAttribute('src');
    globalThis.__LUNACY_PATCH_STATUS__ = 'patching';

    try {
      const entryCode = await fetchText(entryUrl);
      const imports = core.directImports(entryCode).slice(0, 12);
      let engine = null;
      for (const spec of imports) {
        const url = new URL(spec, entryUrl).href;
        const code = await fetchText(url);
        if (core.isEngine(code)) { engine = { spec, url, code }; break; }
      }
      if (!engine) throw new Error('Игровой модуль не найден среди прямых импортов.');

      const engineCode = core.patchEngine(engine.code, engine.url);
      const engineBlob = URL.createObjectURL(new Blob([engineCode], { type: 'text/javascript' }));
      const patchedEntry = core.patchEntry(entryCode, entryUrl, engine.spec, engineBlob);
      const entryBlob = URL.createObjectURL(new Blob([patchedEntry], { type: 'text/javascript' }));
      const replacement = document.createElement('script');
      replacement.type = 'module';
      replacement.src = entryBlob;
      replacement.dataset.lunacy = 'patched';
      (document.head || document.documentElement).appendChild(replacement);
      globalThis.__LUNACY_PATCH_STATUS__ = 'loaded';
      setTimeout(() => { URL.revokeObjectURL(entryBlob); }, 30_000);
    } catch (error) {
      console.warn('[Lunacy] Безопасный запуск оригинального клиента:', error.message);
      restore(entryUrl);
    }
  }

  function inspect(node) {
    if (intercepted || !(node instanceof HTMLScriptElement)) return;
    if (node.type !== 'module' || node.dataset.lunacy) return;
    if (!/\/c\/[a-zA-Z0-9_-]+\.js$/.test(new URL(node.src, location.href).pathname)) return;
    intercepted = true;
    observer.disconnect();
    bootstrap(node);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      inspect(node);
      if (node.querySelectorAll) node.querySelectorAll('script[type="module"]').forEach(inspect);
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  document.querySelectorAll?.('script[type="module"]').forEach(inspect);
})();
