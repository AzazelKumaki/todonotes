@echo off
REM 双击这个文件 = 启动本地同步服务器（试用用，不用注册任何账号）
cd /d %~dp0

set NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
if exist "%NODE_EXE%" goto run

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] 没找到 node.exe，这台电脑上需要先装 Node.js
  echo.
  pause
  exit /b 1
)
set NODE_EXE=node

:run
"%NODE_EXE%" sync-server.js
pause
