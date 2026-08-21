#!/usr/bin/env bash
# Generate app icons (build/icon.icns, icon.ico, icon.png) from assets/logo.svg.
# Run on macOS after placing the logo. Then re-add the "icon" keys to package.json
# (mac:build/icon.icns, win:build/icon.ico, linux:build/icon.png).
# Requires: rsvg-convert (brew install librsvg) for SVG→PNG; iconutil (built-in) for icns.
set -euo pipefail
cd "$(dirname "$0")/.."
SVG="assets/logo.svg"
[ -f "$SVG" ] || { echo "missing $SVG"; exit 1; }
mkdir -p build
rm -rf build/icon.iconset
mkdir -p build/icon.iconset

render() { # size out
  if command -v rsvg-convert >/dev/null; then rsvg-convert -w "$1" -h "$1" "$SVG" -o "$2"
  elif command -v inkscape >/dev/null; then inkscape "$SVG" -w "$1" -h "$1" -o "$2"
  else qlmanage -t -s "$1" -o /tmp "$SVG" >/dev/null 2>&1 && cp "/tmp/$(basename "$SVG").png" "$2"; fi
}

for s in 16 32 128 256 512; do
  render "$s" "build/icon.iconset/icon_${s}x${s}.png"
  render "$((s * 2))" "build/icon.iconset/icon_${s}x${s}@2x.png"
done
cp build/icon.iconset/icon_512x512.png build/icon.png
if iconutil -c icns build/icon.iconset -o build/icon.icns; then
  echo "created build/icon.icns"
else
  rm -f build/icon.icns
  echo "warning: iconutil rejected the generated iconset; electron-builder will use icon.png"
fi
# macOS status-item images are monochrome templates. Preserve the logo's
# natural aspect ratio and transparency so it stays legible at menu-bar size.
rsvg-convert -h 36 --keep-aspect-ratio "$SVG" -o build/trayTemplate.png
# .ico (needs imagemagick); skip gracefully
if command -v magick >/dev/null || command -v convert >/dev/null; then
  bin=$(command -v magick || command -v convert)
  "$bin" build/icon.iconset/icon_16x16.png build/icon.iconset/icon_32x32.png \
         build/icon.iconset/icon_32x32@2x.png build/icon.iconset/icon_128x128.png \
         build/icon.iconset/icon_256x256.png build/icon.ico && echo "created build/icon.ico"
else
  echo "warning: ImageMagick is unavailable; build/icon.ico was not generated"
fi
echo "done. Re-add icon keys to package.json to use them."
