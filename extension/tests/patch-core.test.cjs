const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../patch-core.js');

const engineFixture = 'function eE(e){return Number.isFinite(e)?Math.min(YT,Math.max(JT,e)):YT} class Camera{update(){let o=this.Ir.x/2/this.zoom,s=this.Ir.y/2/this.zoom;}} var $=new hA; var ll={},Wr=new Map,Z={},Pm={};';

test('extended zoom and render culling are patched once', () => {
  const output = core.patchEngine(engineFixture, 'https://mope.io/c/engine.js');
  assert.match(output, /__LUNACY_ZOOM_CLAMP__/);
  assert.match(output, /__LUNACY_RENDER_RANGE__\?\?1/);
  assert.match(output, /get game\(\)\{return \$\}/);
  assert.equal((output.match(/__LUNACY_MOPE__/g) || []).length, 1);
});

test('unknown client is rejected instead of partially patched', () => {
  assert.throws(() => core.patchEngine('var $=new hA;', 'https://mope.io/c/new.js'), /Сигнатуры/);
  assert.equal(core.isEngine('console.log(1)'), false);
});

test('relative static, dynamic imports and import.meta.url survive blob module', () => {
  const code = 'import "./a.js"; import {x} from "../packages/b.js"; const c=import("./c.js"); const u=new URL("./a.png",import.meta.url);';
  const output = core.absolutizeImports(code, 'https://mope.io/c/main.js');
  assert.match(output, /https:\/\/mope.io\/c\/a.js/);
  assert.match(output, /https:\/\/mope.io\/packages\/b.js/);
  assert.match(output, /import\("https:\/\/mope.io\/c\/c.js"\)/);
  assert.match(output, /"https:\/\/mope.io\/c\/main.js"/);
  assert.doesNotMatch(output, /import\.meta\.url/);
});

test('entry is redirected to patched engine and other imports stay valid', () => {
  const entry = 'import"./engine.js";import"./ui.js";';
  const output = core.patchEntry(entry, 'https://mope.io/c/entry.js', './engine.js', 'blob:https://mope.io/test');
  assert.match(output, /blob:https:\/\/mope.io\/test/);
  assert.match(output, /https:\/\/mope.io\/c\/ui.js/);
  assert.deepEqual(core.directImports(entry), ['./engine.js', './ui.js']);
});
