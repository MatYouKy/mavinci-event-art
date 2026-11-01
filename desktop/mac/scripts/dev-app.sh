#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# A debug .app preserves Info.plist and Calendar permission support, unlike a bare swift run.
CONFIGURATION=debug ./scripts/build-app.sh
exec "$(pwd)/build/Mavinci-Dev.app/Contents/MacOS/Mavinci"
