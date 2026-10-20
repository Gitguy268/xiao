// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Small Marionette client (the protocol Firefox/Zen speak with --marionette).
import net from 'node:net';

export class Marionette {
  static async connect(port = 2828, timeoutMs = 60_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      try {
        const m = new Marionette(await new Promise((ok, fail) => {
          const s = net.connect(port, '127.0.0.1', () => ok(s));
          s.once('error', fail);
        }));
        await m.hello;
        await m.send('WebDriver:NewSession', { capabilities: {} });
        return m;
      } catch (e) {
        if (Date.now() > until) throw new Error(`Marionette not reachable on ${port}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.waiting = new Map();
    let buf = Buffer.alloc(0);
    this.hello = new Promise((resolve) => { this.onHello = resolve; });
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const colon = buf.indexOf(':');
        if (colon < 0) return;
        const len = Number(buf.subarray(0, colon));
        if (buf.length < colon + 1 + len) return;
        const msg = JSON.parse(buf.subarray(colon + 1, colon + 1 + len));
        buf = buf.subarray(colon + 1 + len);
        if (!Array.isArray(msg)) this.onHello(msg);
        else this.waiting.get(msg[1])?.(msg);
      }
    });
  }

  send(name, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.waiting.set(id, ([, , error, result]) => {
        this.waiting.delete(id);
        if (error) reject(new Error(`${name}: ${error.error}: ${error.message}`));
        else resolve(result);
      });
      const body = Buffer.from(JSON.stringify([0, id, name, params]));
      this.socket.write(`${body.length}:`);
      this.socket.write(body);
    });
  }

  async chrome(fn, ...args) { // run fn(...args) in the browser's privileged scope
    await this.send('Marionette:SetContext', { value: 'chrome' });
    return this.eval(fn, args);
  }

  async content(handle, fn, ...args) { // run fn(...args) in a tab's page
    await this.send('WebDriver:SwitchToWindow', { handle });
    await this.send('Marionette:SetContext', { value: 'content' });
    return this.eval(fn, args);
  }

  async eval(fn, args) {
    // mod(path): import a Firefox module by its source path. Firefox is moving
    // modules from resource:// to moz-src:///, so try both (and chrome:// for remote/).
    const script = `const mod = (path) => {
        const name = path.split('/').pop();
        for (const uri of ['moz-src:///' + path, 'resource://gre/modules/' + name, 'resource:///modules/' + name,
          'chrome://remote/content/' + path.replace(/^remote\\//, '')]) {
          try { return ChromeUtils.importESModule(uri); } catch {}
        }
        throw new Error('cannot import ' + path);
      };
      const done = arguments[arguments.length - 1];
      Promise.resolve((${fn})(...Array.from(arguments).slice(0, -1))).then(done, (e) => done({ __error: String(e) }));`;
    const { value } = await this.send('WebDriver:ExecuteAsyncScript', { script, args, scriptTimeout: 90_000 });
    if (value?.__error) throw new Error(value.__error);
    return value;
  }

  async screenshot(handle) {
    await this.send('WebDriver:SwitchToWindow', { handle });
    await this.send('Marionette:SetContext', { value: 'content' });
    return Buffer.from((await this.send('WebDriver:TakeScreenshot', { full: false })).value, 'base64');
  }

  close() { this.socket.end(); }
}
