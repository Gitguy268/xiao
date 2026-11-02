// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Send a note to a device on the same Wi-Fi, with textarea's WebRTC code, so no
// server is involved. Two things make that possible, both only while a Send
// page is open, and the page says so:
// - this computer's real local addresses, which Xiao otherwise hides from every
//   site (shared/prefs/balanced.yaml);
// - a tiny web server on 127.0.0.1 with a secret path, serving the page itself,
//   because Firefox never starts WebRTC on a resource:// page.
import { contentTypeOf, sendFile } from './lib/send.mjs';

const { NetUtil } = ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs');

const PREFS = [
  ['media.peerconnection.ice.no_host', false],
  ['media.peerconnection.ice.default_address_only', false],
  ['media.peerconnection.ice.obfuscate_host_addresses', false],
];
const KEY = 'xiao:sendOrigin';
const NOT_FOUND = 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';
const CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export class Send {
  pages = new Set();
  saved = null;
  origin = ''; // http://127.0.0.1:<port>/<secret>/, while the server runs

  // Opens a Send page in a tab, starting the server if this is the first.
  async open(win) {
    if (!this.server) this.listen();
    const tab = win.gBrowser.addTab(`${this.origin}index.html`, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    win.gBrowser.selectedTab = tab;
    return tab;
  }

  listen() {
    const secret = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.server = Cc['@mozilla.org/network/server-socket;1'].createInstance(Ci.nsIServerSocket);
    this.server.init(-1, true, -1); // loopback only
    this.prefix = `/${secret}/`;
    this.host = `127.0.0.1:${this.server.port}`;
    this.origin = `http://${this.host}${this.prefix}`;
    Services.ppmm.sharedData.set(KEY, this.origin);
    Services.ppmm.sharedData.flush();
    this.server.asyncListen({
      onSocketAccepted: (_server, transport) => this.answer(transport),
      onStopListening() {},
    });
  }

  close() {
    this.server?.close();
    this.server = null;
    this.origin = '';
    Services.ppmm.sharedData.set(KEY, '');
    Services.ppmm.sharedData.flush();
  }

  answer(transport) {
    const input = transport.openInputStream(0, 0, 0);
    const reader = Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
    reader.init(input);
    let head = '';
    const fail = () => {
      try {
        reader.close();
        transport.close(Cr.NS_OK);
      } catch {}
    };
    const wait = () => input.asyncWait({
      onInputStreamReady: () => {
        try {
          const n = input.available();
          if (!n) return fail();
          head += reader.read(n);
        } catch {
          return fail();
        }
        if (!head.includes('\r\n\r\n')) return head.length > 16_384 ? fail() : wait();
        this.reply(head, transport).catch(fail);
        return undefined;
      },
    }, 0, 0, Services.tm.mainThread);
    wait();
  }

  async reply(head, transport) {
    const [, target = ''] = /^GET (\S+) HTTP\/1\.[01]\r\n/.exec(head) ?? [];
    const host = /\r\nhost: *([^\r]*)\r\n/i.exec(head)?.[1];
    // The host check stops a site pointing its own name at this port.
    const file = host === this.host ? sendFile(target, this.prefix) : null;
    let body = new Uint8Array(0);
    let header = NOT_FOUND;
    if (file) {
      const r = await fetch(`resource://xiao/${file}`).catch(() => null);
      if (r?.ok) {
        body = new Uint8Array(await r.arrayBuffer());
        header = `HTTP/1.1 200 OK\r\nContent-Type: ${contentTypeOf(file)}\r\nContent-Length: ${body.length}\r\nCache-Control: no-store\r\n`
          + `Content-Security-Policy: ${CSP}\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n`;
      }
    }
    const head8 = new TextEncoder().encode(header);
    const all = new Uint8Array(head8.length + body.length);
    all.set(head8);
    all.set(body, head8.length);
    const source = Cc['@mozilla.org/io/arraybuffer-input-stream;1'].createInstance(Ci.nsIArrayBufferInputStream);
    source.setData(all.buffer, 0, all.length);
    // Closing the socket as soon as the copy ends can cut off what is still on its
    // way. The reply states its length, so the browser doesn't need the close.
    NetUtil.asyncCopy(source, transport.openOutputStream(0, 0, 0), () => setTimeout(() => transport.close(Cr.NS_OK), 5000));
  }

  begin(page) {
    if (!this.saved) {
      this.saved = PREFS.map(([name]) => [name, Services.prefs.getBoolPref(name, true)]);
      for (const [name, value] of PREFS) Services.prefs.setBoolPref(name, value);
    }
    this.pages.add(page);
  }

  end(page) {
    this.pages.delete(page);
    if (this.pages.size || !this.saved) return;
    for (const [name, value] of this.saved) Services.prefs.setBoolPref(name, value);
    this.saved = null;
    this.close();
  }
}
