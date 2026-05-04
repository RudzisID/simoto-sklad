@echo off
REM Wrapper script: updates graph and applies community names
REM Usage: scripts\update-graph.bat

echo [1/3] Running graphify update...
graphify update .

echo [2/3] Applying community names...
node scripts\rename-communities.js

echo [3/3] Enhancing visualization...
node scripts\enhance-graph-visualization.js

echo.
echo ✅ Graph updated with logical community names!
echo    Open graphify-out\graph.html to view.
echo    Press "L" to toggle legend.
