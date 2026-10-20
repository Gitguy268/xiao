#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Checks out the pinned Zen tag and turns it into xiao, ready for surfer.
#   sh fork/apply.sh <dir>          (default: fork/build/desktop)
# Then, in <dir>: npm ci && npm run download && npm run import
#   && node <xiao>/fork/overlay.mjs . --engine && npm run bootstrap && npm run build && npm run package
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=${1:-$HERE/build/desktop}
TAG=$(cat "$HERE/ZEN_TAG")
if [ ! -d "$DIR/.git" ]; then
  git clone --quiet --depth 1 --branch "$TAG" https://github.com/zen-browser/desktop "$DIR"
fi
[ "$(git -C "$DIR" describe --tags)" = "$TAG" ] || { echo "$DIR is not at Zen $TAG" >&2; exit 1; }
[ -z "$(git -C "$DIR" status --porcelain)" ] || { echo "$DIR has changes already; use a fresh checkout" >&2; exit 1; }
node "$HERE/overlay.mjs" "$DIR"
