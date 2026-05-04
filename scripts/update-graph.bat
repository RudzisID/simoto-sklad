@echo off
REM Wrapper script: updates graph and applies community names
REM Usage: scripts\update-graph.bat

echo [1/2] Running graphify update...
graphify update .

echo [2/2] Applying community names...
node scripts\rename-communities.js

echo.
echo ✅ Graph updated with logical community names!
echo    Open graphify-out\graph.html to view.
