// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Writes dist/updates.json and its Ed25519 signature for a release. The private
// key comes from the XIAO_UPDATE_KEY secret (PEM) and is never written to disk.
//   node scripts/sign-updates.mjs <tag>
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkManifest, UPDATE_KEY } from '../core/lib/updates.mjs';

const at = (p) => new URL(`../${p}`, import.meta.url);
const tag = process.argv[2];
const { version } = JSON.parse(readFileSync(at('package.json'), 'utf8'));
if (tag !== `v${version}`) throw new Error(`tag ${tag} is not package.json's v${version}`);
const pem = process.env.XIAO_UPDATE_KEY;
if (!pem) throw new Error('XIAO_UPDATE_KEY is not set');
const key = createPrivateKey(pem);
const pub = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
if (pub !== UPDATE_KEY) throw new Error('XIAO_UPDATE_KEY does not match UPDATE_KEY in core/lib/updates.mjs');

const kit = readFileSync(at('dist/xiao-kit.zip'));
const manifest = checkManifest({
  version,
  kit: { url: `https://github.com/Gitguy268/xiao/releases/download/${tag}/xiao-kit.zip`, sha256: createHash('sha256').update(kit).digest('hex'), size: kit.length },
});
if (manifest instanceof Error) throw manifest;
const body = Buffer.from(JSON.stringify(manifest));
writeFileSync(at('dist/updates.json'), body);
writeFileSync(at('dist/updates.json.sig'), sign(null, body, key));
console.log(`dist/updates.json for ${version}`);
