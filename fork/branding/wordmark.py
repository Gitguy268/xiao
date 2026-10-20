# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Draws source/wordmark.svg: "Xiao" in Junicode italic as outlines, so the
# About dialog shows it without the font. make.sh runs it with uvx (fonttools).
#
#   python wordmark.py ../../shared/fonts/junicode-italic-latin.woff2 Xiao > source/wordmark.svg
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
font = TTFont(sys.argv[1]); text = sys.argv[2]; size = 52
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
s = size / upm; x = 4; paths = []
kern = {}
for ch in text:
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, 44)))
    paths.append(pen.getCommands())
    x += gs[name].width * s
w = round(x + 8)
print(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 56">')
print(f'  <!-- "Xiao" in Junicode italic (SIL OFL 1.1), as outlines so it needs no font -->')
import re; d = re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.2f}".rstrip("0").rstrip("."), " ".join(paths)); print(f"  <path fill=\"#fff\" d=\"{d}\"/>")
print('</svg>')
