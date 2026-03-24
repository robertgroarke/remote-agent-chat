@echo off
cd /d "%~dp0agent-proxy"
node index.js > proxy-main.log 2>&1
