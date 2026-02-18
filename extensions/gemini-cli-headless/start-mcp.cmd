@echo off
cd /d "%~dp0"
REM Run mcp-server.ts using the project's local tsx
call "..\..\node_modules\.bin\tsx.cmd" "mcp-server.ts"
