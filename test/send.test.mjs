import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentTypeOf, sendFile } from '../core/lib/send.mjs';

const P = '/secret/';

test('the Send server hands out only its own page under the secret path', () => {
  assert.equal(sendFile('/secret/index.html', P), 'send/index.html');
  assert.equal(sendFile('/secret/vendor/qr/qrcode.mjs', P), 'send/vendor/qr/qrcode.mjs');
  assert.equal(sendFile('/secret/tokens.css', P), 'tokens.css');
  assert.equal(sendFile('/secret/fonts/a.woff2', P), 'fonts/a.woff2');
});

test('without the secret, or with a way out of the folder, it hands out nothing', () => {
  for (const t of ['/index.html', '/wrong/index.html', '/secret/../XiaoCore.sys.mjs', '/secret/..%2fXiaoCore.sys.mjs', '/secret//etc/passwd', '/secret/', '/secret/a/../../b.js', '/secret/index.html?x=1', undefined]) {
    assert.equal(sendFile(t, P), null, String(t));
  }
});

test('types are the ones a browser will run', () => {
  assert.equal(contentTypeOf('send/send.js'), 'text/javascript');
  assert.match(contentTypeOf('send/index.html'), /text\/html/);
  assert.equal(contentTypeOf('send/LICENSE-textarea'), 'application/octet-stream');
});
