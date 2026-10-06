#!/bin/sh
# macOS: double-click (the first time: right-click -> Open). Verifies the AI's patch from the clipboard on a real server and copies
# the result back; then stays open: every patch you copy from the chat is verified the same way. Ctrl+C or close the window to stop.
cd "$(dirname "$0")" || exit 1
chmod +x lab.sh 2>/dev/null
./lab.sh verify --watch
echo
printf 'Enter で閉じます / press Enter to close '; read _
