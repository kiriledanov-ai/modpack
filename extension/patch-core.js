(function initLunacyPatchCore(root) {
  'use strict';

  const ZOOM_TOKEN = 'Math.min(YT,Math.max(JT,e))';
  const CULL_TOKEN = 'let o=this.Ir.x/2/this.zoom,s=this.Ir.y/2/this.zoom;';
  const EXPOSE_TOKEN = 'var $=new hA';

  function isEngine(code) {
    return typeof code === 'string' && code.includes(ZOOM_TOKEN) && code.includes(CULL_TOKEN) && code.includes(EXPOSE_TOKEN);
  }

  function absolutizeImports(code, moduleUrl) {
    const resolve = spec => new URL(spec, moduleUrl).href;
    let output = code
      .replace(/(\bfrom\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (_, prefix, quote, spec) => `${prefix}${quote}${resolve(spec)}${quote}`)
      .replace(/(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (_, prefix, quote, spec) => `${prefix}${quote}${resolve(spec)}${quote}`)
      .replace(/(\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (_, prefix, quote, spec) => `${prefix}${quote}${resolve(spec)}${quote}`);
    output = output.replaceAll('import.meta.url', JSON.stringify(moduleUrl));
    return output;
  }

  function patchEngine(code, moduleUrl) {
    if (!isEngine(code)) throw new Error('Сигнатуры игрового клиента не совпали; оригинальный клиент будет запущен безопасно.');
    let output = code.replace(ZOOM_TOKEN, '(globalThis.__LUNACY_ZOOM_CLAMP__?globalThis.__LUNACY_ZOOM_CLAMP__(e):Math.min(YT,Math.max(JT,e)))');
    output = output.replace(CULL_TOKEN, 'let o=this.Ir.x/2/this.zoom*(globalThis.__LUNACY_RENDER_RANGE__??1),s=this.Ir.y/2/this.zoom*(globalThis.__LUNACY_RENDER_RANGE__??1);');
    output += `\n;globalThis.__LUNACY_MOPE__={get game(){return $},get settings(){return ll},get entities(){return Wr},get profile(){return Z},get account(){return Pm}};globalThis.__LUNACY_ENGINE_READY__=true;dispatchEvent(new CustomEvent('lunacy:engine-ready'));\n`;
    return absolutizeImports(output, moduleUrl);
  }

  function directImports(code) {
    const specs = [];
    const patterns = [
      /\bfrom\s*(['"])(\.{1,2}\/[^'"]+\.js)\1/g,
      /\bimport\s*(['"])(\.{1,2}\/[^'"]+\.js)\1/g
    ];
    for (const pattern of patterns) {
      for (const match of code.matchAll(pattern)) specs.push(match[2]);
    }
    return [...new Set(specs)];
  }

  function patchEntry(code, entryUrl, targetSpec, engineBlobUrl) {
    const replaced = code.split(`'${targetSpec}'`).join(`'${engineBlobUrl}'`).split(`"${targetSpec}"`).join(`"${engineBlobUrl}"`).split('`' + targetSpec + '`').join('`' + engineBlobUrl + '`');
    if (replaced === code) throw new Error('Не удалось подключить модуль Lunacy к точке входа.');
    return absolutizeImports(replaced, entryUrl);
  }

  const api = { isEngine, absolutizeImports, patchEngine, directImports, patchEntry };
  root.LunacyPatchCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
