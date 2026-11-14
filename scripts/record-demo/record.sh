#!/usr/bin/env bash
# Re-records docs/media/editor.gif from the real extension, on a private virtual display (Xvfb),
# so nothing appears on your desktop. Needs: VS Code (`code`), xvfb-run, ffmpeg, python3, network access to osv.dev.
#
#   npm run build -w packages/vscode-osv        # the extension runs from packages/vscode-osv/dist
#   scripts/record-demo/record.sh               # writes docs/media/editor.gif
#
# The demo (index.js) is scripted through the extension host, so the recording is reproducible.
# It applies real fixes to a scratch copy of the demo project, never to this repository.
set -euo pipefail

if [[ -z "${RECORD_INNER:-}" ]]; then
  # Outer call: re-run this script inside a 1280x720 Xvfb server.
  export RECORD_INNER=1
  exec xvfb-run -a -s "-screen 0 1280x720x24" "$0" "$@"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="${1:-$ROOT/docs/media/editor.gif}"
CODE_BIN="${CODE_BIN:-$(dirname "$(readlink -f "$(command -v code)")")/../code}"

mkdir -p "$WORK/ws" "$WORK/ud/User" "$WORK/ext"
cat >"$WORK/ws/package.json" <<'EOF'
{
  "name": "demo-app",
  "version": "1.0.0",
  "dependencies": {
    "lodash": "^4.17.15",
    "minimist": "^1.2.0"
  }
}
EOF
printf 'django==3.0.0\nrequests==2.19.0\n' >"$WORK/ws/requirements.txt"
cat >"$WORK/ud/User/settings.json" <<'EOF'
{
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "chat.disableAIFeatures": true,
  "window.commandCenter": false,
  "window.titleBarStyle": "custom",
  "editor.minimap.enabled": false,
  "workbench.colorTheme": "Default Dark Modern",
  "git.enabled": false
}
EOF
cp "$HERE/index.js" "$WORK/index.js"

# Force X11 even when the calling session is Wayland, or the window would open on the real desktop.
unset WAYLAND_DISPLAY
export XDG_SESSION_TYPE=x11
# Display size and the sash position (x of the side bar's right edge, y mid-screen) are tied to the Xvfb screen above.
ffmpeg -v error -y -f x11grab -framerate 10 -video_size 1280x720 -i "$DISPLAY" -c:v libx264 -preset ultrafast -crf 18 "$WORK/raw.mkv" &
FFMPEG=$!
( while [[ ! -f "$WORK/marker" ]]; do sleep 0.2; done; python3 -I "$HERE/drag.py" 219 500 360 ) &
DRAG=$!
sleep 1
timeout 240 "$CODE_BIN" --ozone-platform=x11 --no-sandbox --disable-gpu --disable-workspace-trust \
  --user-data-dir "$WORK/ud" --extensions-dir "$WORK/ext" \
  --extensionDevelopmentPath="$ROOT/packages/vscode-osv" --extensionTestsPath="$WORK" \
  "$WORK/ws" >"$WORK/code.log" 2>&1 || { tail -20 "$WORK/code.log" >&2; kill "$FFMPEG" "$DRAG" 2>/dev/null || true; exit 1; }
sleep 1
kill -INT "$FFMPEG" 2>/dev/null || true
kill "$DRAG" 2>/dev/null || true
wait "$FFMPEG" 2>/dev/null || true

# Cut the window-loading frames at the start and the black frames after VS Code quits, then build an optimised GIF.
START=2.6
END="$(ffmpeg -v info -i "$WORK/raw.mkv" -vf blackdetect=d=0.2:pix_th=0.05 -an -f null - 2>&1 | sed -n 's/.*black_start:\([0-9.]*\) .*/\1/p' | tail -1)"
END="${END:-45}"
FILTER="fps=10,scale=960:-1:flags=lanczos"
ffmpeg -v error -y -ss "$START" -to "$END" -i "$WORK/raw.mkv" -vf "$FILTER,palettegen=stats_mode=diff:max_colors=96" "$WORK/pal.png"
ffmpeg -v error -y -ss "$START" -to "$END" -i "$WORK/raw.mkv" -i "$WORK/pal.png" \
  -lavfi "$FILTER[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$OUT"
echo "wrote $OUT"
