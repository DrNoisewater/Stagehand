# The pieces Stagehand Setup downloads when your PC doesn't have them yet (4.0.1).
# Pinned versions, so every download can be checked against its SHA-256, which
# build-setup.sh measures from the same files and builds into the installer.
# Used by scripts/session-setup.sh (to fetch them) and windows/setup/build-setup.sh.
VGMSTREAM_VER=r2168
UV_VER=0.13.6
# Electron's version comes from package.json (devDependencies.electron).
electron_url() { echo "https://github.com/electron/electron/releases/download/v$1/electron-v$1-win32-x64.zip"; }
vgmstream_url() { echo "https://github.com/vgmstream/vgmstream/releases/download/$VGMSTREAM_VER/vgmstream-win64.zip"; }
uv_url() { echo "https://github.com/astral-sh/uv/releases/download/$UV_VER/uv-x86_64-pc-windows-msvc.zip"; }
