// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Firefox is moving its modules from resource:// to moz-src:///, so import by
// source path and try both. lazy(path) imports on first use.
export function mod(path) {
  const name = path.split('/').pop();
  for (const uri of [`moz-src:///${path}`, `resource://gre/modules/${name}`, `resource:///modules/${name}`]) {
    try {
      return ChromeUtils.importESModule(uri);
    } catch {}
  }
  throw new Error(`Xiao: cannot import ${path}`);
}

export function lazy(path, exported) {
  let value;
  return () => (value ??= mod(path)[exported]);
}
