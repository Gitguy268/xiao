// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The local AI's page, loaded by Xiao in a hidden tab only while Assist has
// work, and closed after it (core/Assist.mjs). It takes one job at a time from
// Xiao, runs it on MiniCPM5 with textarea's engine (lib/gemma.js, unchanged)
// and gives back the text. It has no other calls into Xiao.
const ask = (name, data) => window.xiao.call(name, data);

async function serve() {
  const { loadEngine } = await import('./lib/gemma.js');
  for (;;) {
    const job = await ask('assist.next');
    if (!job) return;
    try {
      const engine = await loadEngine({ model: 'minicpm5', onProgress: (text) => ask('assist.progress', { id: job.id, text }) });
      ask('assist.progress', { id: job.id, text: 'Writing… this takes a little while on this computer.' });
      await ask('assist.done', { id: job.id, text: await engine.run(job.messages) });
    } catch (e) {
      await ask('assist.done', { id: job.id, error: e?.message || String(e) });
    }
  }
}

if (window.xiao) serve();
