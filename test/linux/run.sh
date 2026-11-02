#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Runs inside a distribution's own container, with the repository at /xiao:
# installs that distribution's libraries, then has Xiao's installer download Zen
# and runs the browser test as an ordinary user.
#   docker run --rm -v "$PWD:/xiao:ro" -e ONLY=shield,bangs debian:13 sh /xiao/test/linux/run.sh
# It tests the distribution's libraries, not the computer's own sandbox rules.
set -eu

# shellcheck disable=SC1091 # each distribution has its own
. /etc/os-release
family="${ID_LIKE:-} ${ID:-}"
say() { printf '== %s\n' "$*"; }
say "$PRETTY_NAME, $(uname -m)"
case $family in
  *debian*|*ubuntu*)
    apt-get update -qq >/dev/null
    gtk=libgtk-3-0; apt-cache show libgtk-3-0t64 >/dev/null 2>&1 && gtk=libgtk-3-0t64
    sound=libasound2; apt-cache show libasound2t64 >/dev/null 2>&1 && sound=libasound2t64
    apt-get install -y -qq --no-install-recommends curl ca-certificates xz-utils zip unzip procps lsof "$gtk" "$sound" libdbus-glib-1-2 libx11-xcb1 >/dev/null
    ;;
  *fedora*)
    dnf install -y -q curl ca-certificates xz zip unzip procps-ng util-linux lsof tar gzip gtk3 dbus-glib alsa-lib libXtst >/dev/null
    ;;
  *arch*)
    pacman -Sy --noconfirm --quiet curl xz zip unzip procps-ng lsof gtk3 dbus-glib alsa-lib >/dev/null
    ;;
  *suse*)
    zypper -q --non-interactive install curl ca-certificates xz zip unzip procps util-linux lsof tar gzip libgtk-3-0 libdbus-glib-1-2 libasound2 libX11-xcb1 >/dev/null
    ;;
  *) echo "no recipe for $family" >&2; exit 2 ;;
esac

NODE=22.11.0
case $(uname -m) in
  x86_64) arch=x64 ;;
  aarch64) arch=arm64 ;;
  *) echo "no Node build for $(uname -m)" >&2; exit 2 ;;
esac
curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-$arch.tar.xz" | tar -xJ -C /opt
ln -s "/opt/node-v$NODE-linux-$arch/bin/node" /usr/local/bin/node

id xiaotest >/dev/null 2>&1 || useradd -m xiaotest
cp -R /xiao /home/xiaotest/xiao-copy 2>/dev/null || true
chown -R xiaotest /home/xiaotest/xiao-copy
cd /home/xiaotest/xiao-copy
su xiaotest -c "cd /home/xiaotest/xiao-copy && E2E_QUIET=0 E2E_OUT=/tmp/xiao-out ONLY='${ONLY:-}' node test/e2e/new-features.mjs"
