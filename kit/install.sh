#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Installs xiao on top of Zen (macOS and Linux). Nothing in Zen itself is
# changed: xiao gets its own profile folder, prefs, extension and launcher. On
# macOS the launcher is a copy of Zen.app named and drawn as xiao; run this
# again after Zen updates to refresh it.
#
#   sh install.sh [--strict] [--tor] [--ubo] [--zen /path/to/zen]
#   sh install.sh --uninstall
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
TOR_VERSION=15.0.25
TOR_PORT=9160
UBO_URL=https://addons.mozilla.org/firefox/downloads/file/5034826/ublock_origin-1.75.0.xpi

STRICT=0 TOR=0 UBO=0 UNINSTALL=0 ZEN=${ZEN:-}
while [ $# -gt 0 ]; do
  case $1 in
    --strict) STRICT=1 ;;
    --tor) TOR=1 ;;
    --ubo) UBO=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --zen) ZEN=$2; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '  %s\n' "$*"; }
die() { printf 'xiao: %s\n' "$*" >&2; exit 1; }

OS=$(uname -s)
ARCH=$(uname -m)
FLATPAK=0
case $OS in
  Darwin)
    DATA="$HOME/Library/Application Support/xiao-kit"
    [ -n "$ZEN" ] || for app in /Applications/Zen.app "$HOME/Applications/Zen.app"; do
      [ -x "$app/Contents/MacOS/zen" ] && ZEN="$app/Contents/MacOS/zen" && break
    done
    TOR_OS=macos
    [ "$ARCH" = arm64 ] && TOR_ARCH=aarch64 || TOR_ARCH=x86_64
    ;;
  Linux)
    DATA="${XDG_DATA_HOME:-$HOME/.local/share}/xiao-kit"
    if [ -z "$ZEN" ]; then
      for z in "$(command -v zen 2>/dev/null || true)" /opt/zen/zen "$HOME/.local/share/zen/zen" /usr/lib/zen-browser/zen; do
        [ -n "$z" ] && [ -x "$z" ] && ZEN=$z && break
      done
    fi
    if [ -z "$ZEN" ] && flatpak info app.zen_browser.zen >/dev/null 2>&1; then
      # The flatpak can only see its own folder, so the profile lives there.
      FLATPAK=1 ZEN="flatpak run app.zen_browser.zen"
      DATA="$HOME/.var/app/app.zen_browser.zen/xiao-kit"
    fi
    TOR_OS=linux TOR_ARCH=$ARCH
    ;;
  *) die "use install.ps1 on Windows" ;;
esac
PROFILE="$DATA/profile"

pgrep -f -- "-profile $PROFILE" >/dev/null 2>&1 && die "xiao is running. Quit it first."

if [ "$UNINSTALL" = 1 ]; then
  [ -f "$DATA/tor.pid" ] && kill "$(cat "$DATA/tor.pid")" 2>/dev/null || true
  rm -rf "$DATA" "$HOME/Applications/xiao.app" "$HOME/Applications/xiao.app.new" "$HOME/Applications/xiao.app.old" "${XDG_DATA_HOME:-$HOME/.local/share}/applications/xiao.desktop"
  echo "xiao removed (profile, Tor and launcher). Zen itself was not touched."
  exit 0
fi

[ -n "$ZEN" ] || die "Zen not found. Install it from https://zen-browser.app or pass --zen /path/to/zen"
for f in xiao.xpi user.js user-strict.js; do
  [ -f "$HERE/$f" ] || die "$f is missing next to install.sh. Run 'npm run build' and use dist/kit/."
done

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
fetch() { # fetch <url> <file>: download and check against downloads.sha256
  name=$(basename "$1")
  want=$(grep " $name\$" "$HERE/downloads.sha256" | cut -d' ' -f1)
  [ -n "$want" ] || die "no pinned hash for $name"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" || die "download failed: $1"
  got=$(sha256 "$2")
  [ "$got" = "$want" ] || { rm -f "$2"; die "$name does not match its pinned hash (got $got)"; }
}

echo "Installing xiao for $ZEN"
mkdir -p "$PROFILE/extensions"
if [ "$STRICT" = 1 ]; then cp "$HERE/user-strict.js" "$PROFILE/user.js"; say "Strict prefs"; else cp "$HERE/user.js" "$PROFILE/user.js"; say "Balanced prefs"; fi
cp "$HERE/xiao.xpi" "$PROFILE/extensions/xiao@gitguy268.github.io.xpi"
say "xiao extension: start page, ad and tracker blocking, Tor container"
cp "$HERE/xiao.svg" "$DATA/xiao.svg" 2>/dev/null || true

if [ "$UBO" = 1 ]; then
  fetch "$UBO_URL" "$PROFILE/extensions/uBlock0@raymondhill.net.xpi"
  say "uBlock Origin 1.75.0 from addons.mozilla.org (GPL-3.0, hash checked)"
fi

TOR_BIN=
if [ "$TOR" = 1 ]; then
  bundle="tor-expert-bundle-$TOR_OS-$TOR_ARCH-$TOR_VERSION.tar.gz"
  if grep -q " $bundle\$" "$HERE/downloads.sha256"; then
    tmp=$(mktemp -d)
    fetch "https://dist.torproject.org/torbrowser/$TOR_VERSION/$bundle" "$tmp/$bundle"
    rm -rf "$DATA/tor" && mkdir -p "$DATA/tor"
    tar -xzf "$tmp/$bundle" -C "$DATA/tor"
    rm -rf "$tmp"
    if [ "$OS" = Darwin ]; then
      # The expert bundle is unsigned and Apple silicon refuses to run unsigned
      # code. Ad-hoc sign it here, after the archive's hash was checked.
      find "$DATA/tor/tor" -type f \( -name tor -o -name '*.dylib' -o -perm -u+x \) -exec codesign --force --sign - {} \; 2>/dev/null
    fi
    TOR_BIN="$DATA/tor/tor/tor"
    say "Tor $TOR_VERSION expert bundle (hash checked)"
  elif command -v tor >/dev/null; then
    TOR_BIN=$(command -v tor)
    say "No Tor bundle for $TOR_OS-$TOR_ARCH; using the system tor at $TOR_BIN"
  else
    die "no Tor bundle for $TOR_OS-$TOR_ARCH. Install tor with your package manager and run again."
  fi
  mkdir -p "$DATA/tor-data" && chmod 700 "$DATA/tor-data"
  {
    echo "SocksPort 127.0.0.1:$TOR_PORT IsolateSOCKSAuth"
    # Quoted: "Application Support" has a space in it.
    echo "DataDirectory \"$DATA/tor-data\""
    echo "PidFile \"$DATA/tor.pid\""
    echo "Log \"notice file $DATA/tor.log\""
    [ -f "$DATA/tor/data/geoip" ] && echo "GeoIPFile \"$DATA/tor/data/geoip\"" && echo "GeoIPv6File \"$DATA/tor/data/geoip6\""
  } > "$DATA/torrc"
else
  rm -rf "$DATA/tor" "$DATA/torrc"
fi

if [ "$OS" = Darwin ]; then
  # A copy of Zen.app with xiao's name, icon and bundle id, so the Dock, Cmd-Tab
  # and the menu bar say xiao. make-app.sh and its files stay in DATA, so the
  # launcher can rebuild the copy whenever Zen.app updates.
  zen_app=${ZEN%/Contents/MacOS/*}
  rm -rf "$DATA/app-assets" && mkdir -p "$DATA/app-assets"
  cp "$HERE/xiao.icns" "$HERE/branding/brand.ftl" "$HERE/branding/brand.properties" "$DATA/app-assets/"
  cp -R "$HERE/branding/content" "$DATA/app-assets/content"
  cp "$HERE/make-app.sh" "$DATA/make-app.sh"
  sh "$DATA/make-app.sh" "$zen_app" "$DATA" || die "could not build xiao.app (see above)"
  ZEN="$HOME/Applications/xiao.app/Contents/MacOS/zen"
  say "App: ~/Applications/xiao.app (a copy of $zen_app, rebuilt when Zen updates)"
fi

if [ "$FLATPAK" = 1 ]; then RUN_ZEN=$ZEN; else RUN_ZEN="\"$ZEN\""; fi
# Linux: its own window class, so docks group xiao under its own icon, not Zen's.
[ "$OS" = Linux ] && RUN_ZEN="$RUN_ZEN --name xiao --class xiao"

# macOS: when Zen.app has updated since xiao.app was built, rebuild xiao.app
# first, so xiao gets Zen's (and Firefox's) security fixes too.
REFRESH=
if [ "$OS" = Darwin ]; then
  REFRESH=$(cat <<'SH'
zen_app=$(cat "$DATA/zen-app" 2>/dev/null)
if [ -f "$zen_app/Contents/Resources/application.ini" ] && ! pgrep -f -- "-profile $DATA/profile" >/dev/null 2>&1 &&
  [ "$(sed -n 's/^BuildID=//p' "$zen_app/Contents/Resources/application.ini")" != "$(cat "$DATA/zen-build" 2>/dev/null)" ]; then
  osascript -e 'display notification "Zen has updated. Updating xiao to match…" with title "xiao"' >/dev/null 2>&1 || true
  sh "$DATA/make-app.sh" "$zen_app" "$DATA" >>"$DATA/make-app.log" 2>&1 || echo "xiao: could not rebuild xiao.app, see $DATA/make-app.log" >&2
fi
SH
)
fi

# The launcher starts tor (if installed), runs Zen on the xiao profile, and stops tor when Zen quits.
cat > "$DATA/xiao-launch" <<LAUNCH
#!/bin/sh
DATA="$DATA"
TOR_BIN="$TOR_BIN"
tor_running() {
  [ -f "\$DATA/tor.pid" ] && ps -p "\$(cat "\$DATA/tor.pid")" -o comm= 2>/dev/null | grep -q tor
}
$REFRESH
# If xiao is already open, its launcher owns tor: leave it alone (Zen just opens a new window there).
if [ -n "\$TOR_BIN" ] && [ -f "\$DATA/torrc" ] && ! tor_running; then
  "\$TOR_BIN" -f "\$DATA/torrc" --quiet &
  TOR_PID=\$!
  trap 'kill \$TOR_PID 2>/dev/null' EXIT INT TERM HUP
fi
$RUN_ZEN -profile "$PROFILE" "\$@"
# On macOS Zen relaunches itself as a GUI app and this first process exits at
# once, so wait for whatever process runs the xiao profile before tor stops.
while pgrep -f -- "-profile $PROFILE" >/dev/null 2>&1; do sleep 2; done
LAUNCH
chmod +x "$DATA/xiao-launch"

if [ "$OS" != Darwin ]; then
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat > "$apps/xiao.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=xiao
Comment=Private browser with ad blocking and Tor tabs
Exec="$DATA/xiao-launch" %u
Icon=$DATA/xiao.svg
Categories=Network;WebBrowser;
StartupNotify=true
StartupWMClass=xiao
DESKTOP
  say "Launcher: xiao in your applications menu"
fi
echo "Done. Start xiao from the launcher, or run: \"$DATA/xiao-launch\""
