#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Installs Xiao on top of Zen (macOS and Linux). Zen itself is not changed:
# Xiao gets its own copy of Zen with Xiao's browser code in it (Xiao.app on
# macOS, a folder on Linux), its own profile, prefs and launcher. The copy is
# rebuilt by the launcher whenever Zen updates.
#
#   sh install.sh [--strict] [--tor] [--search] [--zen /path/to/zen]
#   sh install.sh --uninstall
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
TOR_VERSION=15.0.25
TOR_PORT=${XIAO_TOR_PORT:-9160} # XIAO_TOR_PORT: tests only, so a test install can run beside a real one
SEARCH_PORT=${XIAO_SEARCH_PORT:-8890}
SEARXNG=81371861f67226091d1c4df2e3908a11d3b54eb9

STRICT=0 TOR=0 SEARCH=0 UNINSTALL=0 ZEN=${ZEN:-}
while [ $# -gt 0 ]; do
  case $1 in
    --strict) STRICT=1 ;;
    --tor) TOR=1 ;;
    --search) SEARCH=1 ;;
    --ubo) echo "--ubo was removed in Xiao 0.2: Xiao's own blocking is built in, and two blockers only block twice." >&2 ;;
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
      for z in "$(command -v zen 2>/dev/null || true)" /opt/zen/zen "$HOME/.local/share/zen/zen" /usr/lib/zen-browser/zen /opt/zen-browser-bin/zen-bin; do
        [ -n "$z" ] && [ -x "$z" ] && ZEN=$z && break
      done
    fi
    if [ -z "$ZEN" ] && command -v flatpak >/dev/null && flatpak info app.zen_browser.zen >/dev/null 2>&1; then
      die "Xiao needs a Zen it can copy, and the Flatpak can't be copied. Install Zen's tarball from https://zen-browser.app/download and run this again (or pass --zen /path/to/zen)."
    fi
    TOR_OS=linux TOR_ARCH=$ARCH
    ;;
  *) die "use install.ps1 on Windows" ;;
esac
PROFILE="$DATA/profile"

pgrep -f -- "-profile $PROFILE" >/dev/null 2>&1 && die "Xiao is running. Quit it first."

if [ "$UNINSTALL" = 1 ]; then
  for f in tor.pid searxng.pid; do [ -f "$DATA/$f" ] && kill "$(cat "$DATA/$f")" 2>/dev/null || true; done
  rm -rf "$DATA" "$HOME/Applications/Xiao.app" "$HOME/Applications/Xiao.app.new" "$HOME/Applications/Xiao.app.old" \
    "$HOME/Applications/xiao.app" "${XDG_DATA_HOME:-$HOME/.local/share}/applications/xiao.desktop"
  echo "Xiao removed (its copy of Zen, profile, Tor, search and launcher). Zen itself was not touched."
  exit 0
fi

[ -n "$ZEN" ] || die "Zen not found. Install it from https://zen-browser.app or pass --zen /path/to/zen"
for f in user.js user-strict.js xiao/XiaoCore.sys.mjs loader/xiao.cfg; do
  [ -f "$HERE/$f" ] || die "$f is missing next to install.sh. Run 'npm run build' and use dist/kit/."
done
# The folder that holds Zen's application.ini: Zen.app on macOS, Zen's own folder on Linux.
if [ "$OS" = Darwin ]; then
  ZEN_HOME=${ZEN%/Contents/MacOS/*}
else
  ZEN_HOME=$(dirname "$(readlink -f "$ZEN")")
  [ -f "$ZEN_HOME/application.ini" ] || die "$ZEN_HOME has no application.ini; pass --zen with the zen binary inside Zen's folder"
fi

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
fetch() { # fetch <url> <file> [name]: download and check against downloads.sha256
  name=${3:-$(basename "$1")}
  want=$(grep " $name\$" "$HERE/downloads.sha256" | cut -d' ' -f1)
  [ -n "$want" ] || die "no pinned hash for $name"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" || die "download failed: $1"
  got=$(sha256 "$2")
  [ "$got" = "$want" ] || { rm -f "$2"; die "$name does not match its pinned hash (got $got)"; }
}

echo "Installing Xiao for $ZEN_HOME"
mkdir -p "$PROFILE"
if [ "$STRICT" = 1 ]; then cp "$HERE/user-strict.js" "$PROFILE/user.js"; say "Strict prefs"; else cp "$HERE/user.js" "$PROFILE/user.js"; say "Balanced prefs"; fi
# Xiao 0.1 was an extension (and could add uBlock Origin). Both go: blocking is built in now.
rm -f "$PROFILE/extensions/xiao@gitguy268.github.io.xpi" "$PROFILE/extensions/uBlock0@raymondhill.net.xpi"
rm -rf "$PROFILE/browser-extension-data/xiao@gitguy268.github.io" "$PROFILE/browser-extension-data/uBlock0@raymondhill.net"
cp "$HERE/xiao.svg" "$DATA/xiao.svg" 2>/dev/null || true

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

# Xiao Search: Xiao's own SearXNG (AGPL-3.0, downloaded at a pinned commit and
# hash checked, never shipped with Xiao), on this computer only, running only
# while Xiao runs. Xiao's look is added to the installed copy: one stylesheet
# link and Xiao's mark in place of SearXNG's.
PY=
if [ "$SEARCH" = 1 ]; then
  S="$DATA/searxng"
  tarball="searxng-$SEARXNG.tar.gz"
  tmp=$(mktemp -d)
  fetch "https://github.com/searxng/searxng/archive/$SEARXNG.tar.gz" "$tmp/$tarball" "$tarball"
  rm -rf "$S" && mkdir -p "$S"
  tar -xzf "$tmp/$tarball" -C "$tmp"
  mv "$tmp/searxng-$SEARXNG" "$S/src"
  rm -rf "$tmp"
  if command -v uv >/dev/null; then
    { uv venv -q --python 3.12 "$S/venv" && uv pip install -q --python "$S/venv/bin/python" -r "$S/src/requirements.txt"; } \
      || die "could not install Xiao Search's Python packages"
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null || die "Xiao Search needs Python 3.10 or newer (or uv)"
    { python3 -m venv "$S/venv" && "$S/venv/bin/pip" install -q -r "$S/src/requirements.txt"; } \
      || die "could not install Xiao Search's Python packages"
  fi
  PY="$S/venv/bin/python"
  theme="$S/src/searx/static/themes/simple"
  cp "$HERE/search/xiao.css" "$theme/xiao.css"
  cp "$HERE/xiao/fonts/"*.woff2 "$theme/"
  for f in favicon.svg searxng.svg; do cp "$HERE/xiao/icons/xiao.svg" "$theme/img/$f"; done
  command -v rsvg-convert >/dev/null && for f in favicon.png searxng.png; do rsvg-convert -w 128 -h 128 "$HERE/xiao/icons/xiao.svg" > "$theme/img/$f"; done
  base="$S/src/searx/templates/simple/base.html"
  grep -q "sxng-ltr.min.css" "$base" || die "SearXNG's base.html changed; Xiao's style can't be added"
  sed "/filename='sxng-ltr.min.css'/a\\
  <link rel=\"stylesheet\" href=\"{{ url_for('static', filename='xiao.css') }}\" type=\"text/css\">
" "$base" > "$base.new" && mv "$base.new" "$base"
  grep -q "filename='xiao.css'" "$base" || die "could not add Xiao's style to Xiao Search"
  secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  cat > "$S/settings.yml" <<YAML
use_default_settings: true
general:
  instance_name: "Xiao Search"
  donation_url: false
  contact_url: false
  enable_metrics: false
search:
  autocomplete: ""
  formats: [html]
server:
  bind_address: "127.0.0.1"
  port: $SEARCH_PORT
  secret_key: "$secret"
  limiter: false
  image_proxy: true
  method: "GET"
ui:
  center_alignment: true
  query_in_title: false
  results_on_new_tab: false
YAML
  chmod 600 "$S/settings.yml"
  say "Xiao Search: SearXNG ${SEARXNG%"${SEARXNG#???????}"} on 127.0.0.1:$SEARCH_PORT, runs while Xiao runs (hash checked)"
else
  rm -rf "$DATA/searxng"
fi

# Settings Xiao's browser code reads (core/Tor.mjs, XiaoCore.sys.mjs). In
# user.js, so they are applied again at every start.
{
  echo ""
  echo "// Set by install.sh for this install."
  echo "user_pref(\"xiao.tor.port\", $TOR_PORT);"
  if [ -n "$TOR_BIN" ]; then echo 'user_pref("xiao.tor.installed", true);'; else echo 'user_pref("xiao.tor.installed", false);'; fi
  if [ -n "$PY" ]; then echo "user_pref(\"xiao.search.url\", \"http://127.0.0.1:$SEARCH_PORT/search?q=%s\");"; else echo 'user_pref("xiao.search.url", "");'; fi
} >> "$PROFILE/user.js"

# Xiao's copy of Zen. make-app.sh and its files stay in DATA, so the launcher
# can rebuild the copy whenever Zen updates.
rm -rf "$DATA/app-assets" && mkdir -p "$DATA/app-assets"
cp "$HERE/xiao.icns" "$HERE/branding/brand.ftl" "$HERE/branding/brand.properties" "$DATA/app-assets/"
cp -R "$HERE/branding/content" "$DATA/app-assets/content"
cp -R "$HERE/xiao" "$HERE/loader" "$DATA/app-assets/"
cp "$HERE/make-app.sh" "$DATA/make-app.sh"
sh "$DATA/make-app.sh" "$ZEN_HOME" "$DATA" || die "could not build Xiao's copy of Zen (see above)"
if [ "$OS" = Darwin ]; then
  # On a case-sensitive disk 0.1's lowercase xiao.app is still there.
  for d in "$HOME"/Applications/*; do [ "${d##*/}" = xiao.app ] && rm -rf "$d"; done
  RUN_ZEN="\"$HOME/Applications/Xiao.app/Contents/MacOS/zen\""
  say "App: ~/Applications/Xiao.app (a copy of $ZEN_HOME, rebuilt when Zen updates)"
else
  # Its own window class, so docks group Xiao under its own icon, not Zen's.
  RUN_ZEN="\"$DATA/app/$(basename "$(readlink -f "$ZEN")")\" --name xiao --class xiao"
  say "App: $DATA/app (a copy of $ZEN_HOME, rebuilt when Zen updates)"
fi

# The launcher: if Zen has updated since Xiao's copy was built, rebuild the
# copy first, so Xiao gets Zen's (and Firefox's) security fixes too. Then it
# starts tor and Xiao Search (if installed), runs the copy on Xiao's profile,
# and stops them when Xiao quits.
NOTIFY=
[ "$OS" = Darwin ] && NOTIFY="osascript -e 'display notification \"Zen has updated. Updating Xiao to match…\" with title \"Xiao\"' >/dev/null 2>&1 || true"
cat > "$DATA/xiao-launch" <<LAUNCH
#!/bin/sh
DATA="$DATA"
TOR_BIN="$TOR_BIN"
PY="$PY"
running() { # running <pid file> <process name>
  [ -f "\$DATA/\$1" ] && ps -p "\$(cat "\$DATA/\$1")" -o comm= 2>/dev/null | grep -qi "\$2"
}
zen=\$(cat "\$DATA/zen-app" 2>/dev/null)
ini="\$zen/$( [ "$OS" = Darwin ] && echo Contents/Resources/ )application.ini"
if [ -f "\$ini" ] && ! pgrep -f -- "-profile $PROFILE" >/dev/null 2>&1 &&
  [ "\$(sed -n 's/^BuildID=//p' "\$ini")" != "\$(cat "\$DATA/zen-build" 2>/dev/null)" ]; then
  $NOTIFY
  sh "\$DATA/make-app.sh" "\$zen" "\$DATA" >>"\$DATA/make-app.log" 2>&1 || echo "xiao: could not rebuild Xiao's copy of Zen, see \$DATA/make-app.log" >&2
fi
# If Xiao is already open, its launcher owns tor and search: leave them alone (Zen just opens a new window there).
PIDS=
if [ -n "\$TOR_BIN" ] && [ -f "\$DATA/torrc" ] && ! running tor.pid tor; then
  "\$TOR_BIN" -f "\$DATA/torrc" --quiet &
  PIDS="\$PIDS \$!"
fi
if [ -n "\$PY" ] && [ -x "\$PY" ] && ! running searxng.pid python; then
  (cd "\$DATA/searxng/src" && SEARXNG_SETTINGS_PATH="\$DATA/searxng/settings.yml" exec "\$PY" -m searx.webapp >"\$DATA/searxng.log" 2>&1) &
  echo \$! > "\$DATA/searxng.pid"
  PIDS="\$PIDS \$!"
fi
[ -n "\$PIDS" ] && trap 'kill \$PIDS 2>/dev/null; rm -f "\$DATA/searxng.pid"' EXIT INT TERM HUP
$RUN_ZEN -profile "$PROFILE" "\$@"
# On macOS Zen relaunches itself as a GUI app and this first process exits at
# once, so wait for whatever process runs the Xiao profile before tor stops.
while pgrep -f -- "-profile $PROFILE" >/dev/null 2>&1; do sleep 2; done
LAUNCH
chmod +x "$DATA/xiao-launch"

if [ "$OS" != Darwin ]; then
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat > "$apps/xiao.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Xiao
Comment=Private browser with ad blocking and Tor tabs
Exec="$DATA/xiao-launch" %u
Icon=$DATA/xiao.svg
Categories=Network;WebBrowser;
StartupNotify=true
StartupWMClass=xiao
DESKTOP
  say "Launcher: Xiao in your applications menu"
fi
echo "Done. Start Xiao from the launcher, or run: \"$DATA/xiao-launch\""
