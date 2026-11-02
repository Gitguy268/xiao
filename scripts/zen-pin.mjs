// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Moves Xiao to Zen's latest release: its tag and the hashes of its Linux
// tarballs (GitHub's digests of the release's own files), and the next patch
// version. Prints the tag, or nothing if Xiao is already on it.
import { readFileSync, writeFileSync } from 'node:fs';

const at = (p) => new URL(`../${p}`, import.meta.url);
const edit = (p, fn) => writeFileSync(at(p), fn(readFileSync(at(p), 'utf8')));
const headers = { accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN && { authorization: `Bearer ${process.env.GH_TOKEN}` }) };
const release = await (await fetch('https://api.github.com/repos/zen-browser/desktop/releases/latest', { headers })).json();
const tag = release.tag_name;
if (!tag) throw new Error(`no latest Zen release: ${release.message}`);
if (readFileSync(at('fork/ZEN_TAG'), 'utf8').trim() === tag) process.exit(0);

const digest = (name) => {
  const hash = release.assets.find((a) => a.name === name)?.digest?.replace('sha256:', '');
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) throw new Error(`no digest for ${name}`);
  return hash;
};
edit('kit/downloads.sha256', (s) => s
  .replace(/^[0-9a-f]{64} {2}zen\.linux-x86_64\.tar\.xz$/m, `${digest('zen.linux-x86_64.tar.xz')}  zen.linux-x86_64.tar.xz`)
  .replace(/^[0-9a-f]{64} {2}zen\.linux-aarch64\.tar\.xz$/m, `${digest('zen.linux-aarch64.tar.xz')}  zen.linux-aarch64.tar.xz`)
  .replace(/^# Zen \S+, used/m, `# Zen ${tag}, used`));
edit('kit/install.sh', (s) => s.replace(/^ZEN_VERSION=\S+/m, `ZEN_VERSION=${tag}`));
edit('fork/ZEN_TAG', () => `${tag}\n`);
edit('.github/workflows/ci.yml', (s) => s.replace(/ZEN_VERSION: \S+/, `ZEN_VERSION: ${tag}`));
edit('package.json', (s) => s.replace(/"version": "(\d+)\.(\d+)\.(\d+)"/, (_, a, b, c) => `"version": "${a}.${b}.${Number(c) + 1}"`));
console.log(tag);
