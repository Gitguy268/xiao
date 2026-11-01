#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Builds Xiao's own copy of Zen with Xiao's browser code in it (the xiao
# folder plus the AutoConfig files that load it), so blocking, Tor routing and
# the start page are part of the browser, not an extension.
#   macOS: ~/Applications/Xiao.app, with Xiao's name, icon, bundle id, menus
#          and About dialog, and no updater (Zen's would turn it back into Zen).
#   Linux: <data>/app, a copy of Zen's folder.
# install.sh runs it, and xiao-launch runs it again whenever Zen has updated,
# so Xiao never stays on an old Firefox.
#
#   sh make-app.sh <Zen.app or Zen's folder> <xiao data folder>
set -eu

zen=$1 DATA=$2
assets="$DATA/app-assets"
case $(uname -s) in
  Darwin) app="$HOME/Applications/Xiao.app" res=Contents/Resources ;;
  *) app="$DATA/app" res=. ;;
esac
new="$app.new"
die() { printf 'xiao: %s\n' "$*" >&2; rm -rf "$new"; exit 1; }

[ -f "$zen/$res/application.ini" ] && [ "$zen" != "$app" ] || die "$zen is not a Zen install"
mkdir -p "$(dirname "$app")"
rm -rf "$new"
if [ "$res" = . ]; then
  cp -a --reflink=auto "$zen" "$new" 2>/dev/null || cp -a "$zen" "$new"
  rm -f "$new/updater" "$new/updater.ini" "$new/update-settings.ini"
else
  cp -cR "$zen" "$new" 2>/dev/null || cp -R "$zen" "$new" # -c: APFS clone, no extra disk
  rm -rf "$new/Contents/MacOS/updater.app" "$new/Contents/Library/LaunchServices"
fi
R="$new/$res"
mkdir -p "$R/distribution" "$R/defaults/pref"
echo '{ "policies": { "DisableAppUpdate": true } }' > "$R/distribution/policies.json"
cp "$assets/loader/autoconfig.js" "$R/defaults/pref/autoconfig.js"
cp "$assets/loader/xiao.cfg" "$R/xiao.cfg"
rm -rf "$R/xiao" && cp -R "$assets/xiao" "$R/xiao"
# Menus ("About Xiao", "Quit Xiao") and the About dialog: swap Zen's brand
# strings and logos inside the copy's browser/omni.ja and zip it again.
jar="$R/browser/omni.ja" tmp=$(mktemp -d)
(cd "$tmp" && unzip -qo "$jar" >/dev/null 2>&1) || true # Mozilla's optimised jar makes unzip warn
[ -f "$tmp/chrome/browser/content/branding/about-logo.png" ] || { rm -rf "$tmp"; die "unexpected layout in $jar"; }
for f in "$tmp"/localization/*/branding/brand.ftl; do cp "$assets/brand.ftl" "$f"; done
for f in "$tmp"/chrome/*/locale/branding/brand.properties; do cp "$assets/brand.properties" "$f"; done
cp "$assets"/content/* "$tmp/chrome/browser/content/branding/"
rm "$jar" && (cd "$tmp" && zip -qr0XD "$jar" .)
rm -rf "$tmp"

if [ "$res" != . ]; then
  cp "$assets/xiao.icns" "$R/firefox.icns"
  for f in "$R"/*.lproj/InfoPlist.strings; do printf 'CFBundleName = "Xiao";\n' > "$f"; done
  printf '#!/bin/sh\nexec "%s" "$@"\n' "$DATA/xiao-launch" > "$new/Contents/MacOS/xiao"
  chmod +x "$new/Contents/MacOS/xiao"
  plist="$new/Contents/Info.plist"
  for kv in CFBundleName=Xiao CFBundleDisplayName=Xiao CFBundleIdentifier=io.github.gitguy268.xiao CFBundleExecutable=xiao; do
    /usr/libexec/PlistBuddy -c "Delete :${kv%%=*}" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :${kv%%=*} string ${kv#*=}" "$plist"
  done
  xattr -cr "$new" 2>/dev/null || true # codesign refuses Finder info and quarantine marks
  codesign --force --deep --sign - "$new" 2>/dev/null || die "could not sign $new"
fi

# Downloaded features (core/Packs.mjs) live in the app folder, the only place
# Firefox's content sandbox can read them from: carry them into the new copy.
# A rename on the same disk, so even the 1.8 GB voice models move instantly.
[ -d "$app/$res/xiao-packs" ] && mv "$app/$res/xiao-packs" "$R/xiao-packs"

# Swap in the finished copy, so an interrupted rebuild never leaves a broken app.
# On macOS this also renames 0.1's lowercase xiao.app (the disk ignores case).
rm -rf "$app.old"
[ -d "$app" ] && mv "$app" "$app.old"
mv "$new" "$app"
rm -rf "$app.old"
# Zen's cached copy of the old strings and code lives in the profile.
rm -rf "$DATA/profile/startupCache" "$DATA/profile/compatibility.ini"
# The launcher compares this with Zen's to know when to rebuild.
sed -n 's/^BuildID=//p' "$zen/$res/application.ini" > "$DATA/zen-build"
printf '%s\n' "$zen" > "$DATA/zen-app"
