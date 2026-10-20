#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# macOS: builds ~/Applications/xiao.app as a copy of Zen.app with xiao's name,
# icon, bundle id, menus and About dialog, and no updater (Zen's would turn it
# back into Zen). install.sh runs it, and xiao-launch runs it again whenever
# Zen.app has updated, so xiao.app never stays on an old Firefox.
#
#   sh make-app.sh <Zen.app> <xiao data folder>
set -eu

zen_app=$1 DATA=$2
assets="$DATA/app-assets"
app="$HOME/Applications/xiao.app"
new="$app.new"
die() { printf 'xiao: %s\n' "$*" >&2; rm -rf "$new"; exit 1; }

[ -f "$zen_app/Contents/Info.plist" ] && [ "$zen_app" != "$app" ] || die "$zen_app is not Zen.app"
mkdir -p "$HOME/Applications"
rm -rf "$new"
cp -cR "$zen_app" "$new" 2>/dev/null || cp -R "$zen_app" "$new" # -c: APFS clone, no extra disk
rm -rf "$new/Contents/MacOS/updater.app" "$new/Contents/Library/LaunchServices"
mkdir -p "$new/Contents/Resources/distribution"
echo '{ "policies": { "DisableAppUpdate": true } }' > "$new/Contents/Resources/distribution/policies.json"
cp "$assets/xiao.icns" "$new/Contents/Resources/firefox.icns"
for f in "$new"/Contents/Resources/*.lproj/InfoPlist.strings; do printf 'CFBundleName = "xiao";\n' > "$f"; done
# Menus ("About xiao", "Quit xiao") and the About dialog: swap Zen's brand
# strings and logos inside the copy's browser/omni.ja and zip it again.
jar="$new/Contents/Resources/browser/omni.ja" tmp=$(mktemp -d)
(cd "$tmp" && unzip -qo "$jar" >/dev/null 2>&1) || true # Mozilla's optimised jar makes unzip warn
[ -f "$tmp/chrome/browser/content/branding/about-logo.png" ] || { rm -rf "$tmp"; die "unexpected layout in $jar"; }
for f in "$tmp"/localization/*/branding/brand.ftl; do cp "$assets/brand.ftl" "$f"; done
for f in "$tmp"/chrome/*/locale/branding/brand.properties; do cp "$assets/brand.properties" "$f"; done
cp "$assets"/content/* "$tmp/chrome/browser/content/branding/"
rm "$jar" && (cd "$tmp" && zip -qr0XD "$jar" .)
rm -rf "$tmp"
printf '#!/bin/sh\nexec "%s" "$@"\n' "$DATA/xiao-launch" > "$new/Contents/MacOS/xiao"
chmod +x "$new/Contents/MacOS/xiao"
plist="$new/Contents/Info.plist"
for kv in CFBundleName=xiao CFBundleDisplayName=xiao CFBundleIdentifier=io.github.gitguy268.xiao CFBundleExecutable=xiao; do
  /usr/libexec/PlistBuddy -c "Delete :${kv%%=*}" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :${kv%%=*} string ${kv#*=}" "$plist"
done
xattr -cr "$new" 2>/dev/null || true # codesign refuses Finder info and quarantine marks
codesign --force --deep --sign - "$new" 2>/dev/null || die "could not sign $new"

# Swap in the finished copy, so an interrupted rebuild never leaves a broken xiao.app.
rm -rf "$app.old"
[ -d "$app" ] && mv "$app" "$app.old"
mv "$new" "$app"
rm -rf "$app.old"
# Zen's cached copy of the old strings lives in the profile.
rm -rf "$DATA/profile/startupCache" "$DATA/profile/compatibility.ini"
# The launcher compares this with Zen.app's to know when to rebuild.
sed -n 's/^BuildID=//p' "$zen_app/Contents/Resources/application.ini" > "$DATA/zen-build"
printf '%s\n' "$zen_app" > "$DATA/zen-app"
