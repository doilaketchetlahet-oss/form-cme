// node --test scripts/test-qr-defaults.cjs (no database writes or emails).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const sharp = require('sharp');
const { NextRequest } = require('next/server');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', source)((id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const styles = load('src/lib/qr-style.ts');
const images = load('src/lib/server/qr-image.ts', { '@/lib/qr-style': styles });
const api = load('src/app/api/qr/route.ts', { '@/lib/server/qr-image': images });
const data = 'https://example.test/checkin/00000000-0000-4000-a000-000000000001';

test('missing/reset branding is black and white without logo on client and email renderer', () => {
  for (const input of [undefined, null, {}, styles.DEFAULT_QR_BRANDING]) {
    const style = styles.normalizeQrBranding(input);
    assert.deepEqual(style, styles.DEFAULT_QR_BRANDING);
    assert.deepEqual(images.qrStyleFromBranding(input), style);
    const url = new URL(styles.buildQrImagePath(data, 220, input), 'https://example.test');
    assert.equal(url.searchParams.get('dark'), '#000000');
    assert.equal(url.searchParams.get('accent'), '#000000');
    assert.equal(url.searchParams.get('light'), '#ffffff');
    assert.equal(url.searchParams.get('logo'), '0');
    assert.equal(url.searchParams.get('radius'), '0');
    assert.equal(url.searchParams.has('logoUrl'), false);
    assert.equal(url.searchParams.get('data'), data);
    assert.match(url.searchParams.get('style'), /^qr-v4-/);
  }
});

test('default API and generated email URL both produce square monochrome SVG/PNG', async () => {
  const svgResponse = await api.GET(new NextRequest(`https://example.test/api/qr?${new URLSearchParams({ data })}`));
  assert.equal(svgResponse.status, 200);
  const svg = await svgResponse.text();
  assert.equal(svg.includes('<image'), false);
  assert.deepEqual([...new Set(Array.from(svg.matchAll(/fill="([^"]+)"/g), (match) => match[1]))].sort(), ['#000000', '#ffffff']);
  assert.ok([...svg.matchAll(/rx="([^"]+)"/g)].every((match) => Number(match[1]) === 0));
  for (const size of [160, 220, 520]) {
    const response = await api.GET(new NextRequest(`https://example.test${styles.buildQrImagePath(data, size, null, 'png')}`));
    assert.equal(response.headers.get('content-type'), 'image/png');
    const { data: pixels, info } = await sharp(Buffer.from(await response.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, size * 2); assert.equal(info.height, size * 2);
    assert.deepEqual([...pixels.subarray(0, 4)], [255, 255, 255, 255]);
    let darkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      assert.equal(pixels[index], pixels[index + 1]); assert.equal(pixels[index], pixels[index + 2]);
      assert.equal(pixels[index + 3], 255);
      if (pixels[index] === 0) darkPixels++;
    }
    assert.ok(darkPixels > 0);
  }
});

test('custom branding is preserved and clearing it replaces every custom property', () => {
  const custom = { darkColor: '#0369a1', accentColor: '#0891b2', lightColor: '#f8fdff', logoEnabled: true, logoUrl: '/logo_qr.png', logoSize: 20, moduleRadius: 32 };
  assert.deepEqual(styles.normalizeQrBranding(custom), custom);
  assert.deepEqual(images.qrRenderStyle(custom), custom);
  assert.notEqual(styles.qrStyleKey(custom), styles.qrStyleKey(styles.DEFAULT_QR_BRANDING));
  assert.deepEqual(images.qrRenderStyle(), styles.DEFAULT_QR_BRANDING);
  const bad = { darkColor: 'wrong', logoSize: NaN, moduleRadius: NaN };
  assert.deepEqual(images.qrRenderStyle(bad), styles.DEFAULT_QR_BRANDING);
});

test('an unavailable logo leaves QR modules intact instead of painting an empty central box', async () => {
  const renderer = load('src/lib/server/qr-image.ts', {
    '@/lib/qr-style': styles,
    'node:fs/promises': { readFile: async () => { throw new Error('Logo unavailable'); } },
  });
  const plain = await renderer.renderQrSvg(data, 220, renderer.qrRenderStyle());
  const missingLogo = await renderer.renderQrSvg(data, 220, renderer.qrRenderStyle({ logoEnabled: true }));
  assert.equal(missingLogo, plain);
});
