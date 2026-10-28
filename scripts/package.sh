#!/bin/sh
# Builds into $1 (default: dist/):
#   Stagehand-Setup-<version>.exe   the installer/updater (main download), when SETUP_DEPS is set:
#       SETUP_DEPS="<electron-win32-x64.zip> <vgmstream-win64.zip> <uv-windows.zip>"
#   Stagehand-Windows.zip           backup script installer (downloads the runtime)
#   stagehand-source.zip
# Needs native/bin/stagehand-audio.exe already built (native/build.sh).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
W="$TMP/Stagehand-Windows"
mkdir -p "$W/app/native"
cp -r "$ROOT/src" "$ROOT/engine" "$ROOT/build" "$ROOT/package.json" "$W/app/"
cp -r "$ROOT/native/bin" "$W/app/native/"
cp "$ROOT/windows/install.ps1" "$ROOT/windows/uninstall.ps1" "$ROOT/windows/Install Stagehand.bat" "$ROOT/windows/Uninstall Stagehand.bat" "$ROOT/README.md" "$W/"
find "$TMP" -name __pycache__ -type d -prune -exec rm -rf {} +
rm -f "$OUT/Stagehand-Windows.zip" "$OUT/stagehand-source.zip"
(cd "$TMP" && zip -qr "$OUT/Stagehand-Windows.zip" Stagehand-Windows)
(cd "$ROOT/.." && zip -qr "$OUT/stagehand-source.zip" "$(basename "$ROOT")" -x "*/node_modules/*" "*/native/build/*" "*/dist/*" "*/__pycache__/*")
rm -rf "$TMP"
if [ -n "$SETUP_DEPS" ]; then
  # shellcheck disable=SC2086
  bash "$ROOT/windows/setup/build-setup.sh" "$OUT" $SETUP_DEPS
  rm -rf "$OUT/setup-build" "$OUT/Uninstall Stagehand.exe"
fi
ls -la "$OUT"
