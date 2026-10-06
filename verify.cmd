@echo off
rem Windows: double-click. Verifies the AI's patch from the clipboard on a real server and copies the result back; then stays
rem open: every patch you copy from the chat is verified the same way. Close the window to stop.
cd /d "%~dp0"
chcp 65001 >nul
call lab.cmd verify --watch
echo.
pause
