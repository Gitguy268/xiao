#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Renders fork/branding/release/ (the file set Zen's configs/branding/release
# has) from the SVGs in source/, plus the kit's app icons (kit/xiao.*) and the
# website's favicons. Needs rsvg-convert, ImageMagick and uv (for the wordmark);
# on macOS iconutil makes the .icns, elsewhere png2icns (icnsutils).
set -eu
cd "$(dirname "$0")"
OUT=release
rm -rf "$OUT" && mkdir -p "$OUT/content"
png() { rsvg-convert -w "$2" -h "$2" "source/$1.svg" -o "$3"; }
uvx --quiet --with brotli --from fonttools python wordmark.py ../../shared/fonts/junicode-italic-latin.woff2 Xiao > source/wordmark.svg

for s in 16 22 24 32 48 64 128 256 512 1024; do png app-icon "$s" "$OUT/logo$s.png"; done
cp "$OUT/logo1024.png" "$OUT/logo.png"
cp "$OUT/logo1024.png" "$OUT/logo-mac.png"
png app-icon 1046 "$OUT/VisualElements_150.png"
png app-icon 1046 "$OUT/VisualElements_70.png"
png private 270 "$OUT/PrivateBrowsing_150.png"
png private 126 "$OUT/PrivateBrowsing_70.png"
cp source/app-icon.svg "$OUT/MacOSInstaller.svg"

tmp=$(mktemp -d)
for s in 16 24 32 48 64 256; do png app-icon "$s" "$tmp/a$s.png"; png private "$s" "$tmp/p$s.png"; done
magick "$tmp"/a16.png "$tmp"/a24.png "$tmp"/a32.png "$tmp"/a48.png "$tmp"/a256.png "$OUT/firefox.ico"
cp "$OUT/firefox.ico" "$OUT/firefox64.ico"
cp "$OUT/firefox.ico" "$OUT/document.ico"
cp "$OUT/firefox.ico" "$OUT/document_pdf.ico"
magick "$tmp"/p16.png "$tmp"/p24.png "$tmp"/p32.png "$tmp"/p48.png "$tmp"/p256.png "$OUT/pbmode.ico"
magick -size 164x314 "gradient:#242423-#161616" "$tmp/a64.png" -gravity center -composite -type TrueColorAlpha "BMP3:$OUT/wizWatermark.bmp"

if command -v iconutil >/dev/null; then
  set_dir="$tmp/xiao.iconset" && mkdir "$set_dir"
  for s in 16 32 128 256 512; do
    png app-icon "$s" "$set_dir/icon_${s}x${s}.png"
    png app-icon $((s * 2)) "$set_dir/icon_${s}x${s}@2x.png"
  done
  iconutil -c icns "$set_dir" -o "$OUT/firefox.icns"
else
  png2icns "$OUT/firefox.icns" "$OUT/logo16.png" "$OUT/logo32.png" "$OUT/logo128.png" "$OUT/logo256.png" "$OUT/logo512.png" "$OUT/logo1024.png"
fi

png app-icon 192 "$OUT/content/about-logo.png"
png app-icon 384 "$OUT/content/about-logo@2x.png"
png private 192 "$OUT/content/about-logo-private.png"
png private 384 "$OUT/content/about-logo-private@2x.png"
cp source/app-icon.svg "$OUT/content/about-logo.svg"
cp source/private.svg "$OUT/content/about-logo-private.svg"
cp source/wordmark.svg "$OUT/content/about-wordmark.svg"
cp source/wordmark.svg "$OUT/content/firefox-wordmark.svg"
# The kit's macOS xiao.app swaps these into its copy of Zen's browser/omni.ja.
kit=../../kit
rm -rf "$kit/branding/content" && mkdir -p "$kit/branding/content"
cp "$OUT"/content/about-* "$OUT"/content/firefox-wordmark.svg "$kit/branding/content/"
for s in 16 32 48 64 128; do cp "$OUT/logo$s.png" "$kit/branding/content/icon$s.png"; done
cp source/app-icon.svg ../../kit/xiao.svg
cp "$OUT/firefox.icns" ../../kit/xiao.icns
cp "$OUT/firefox.ico" ../../kit/xiao.ico
# The website: the bare mark for browsers that take SVG, the app icon for the rest
# (an idea from rodneylab/open-source-favicon-generation, BSD-3-Clause).
site=../../site/public
rsvg-convert -w 32 -h 32 ../../core/icons/xiao.svg -o "$tmp/m32.png"
rsvg-convert -w 16 -h 16 ../../core/icons/xiao.svg -o "$tmp/m16.png"
magick "$tmp/m16.png" "$tmp/m32.png" "$site/favicon.ico"
png app-icon 180 "$site/apple-touch-icon.png"
png app-icon 192 "$site/icon-192.png"
png app-icon 512 "$site/icon-512.png"
rm -rf "$tmp"
echo "branding written to $(pwd)/$OUT, kit/xiao.{svg,icns,ico}, kit/branding/content and the site's icons"
