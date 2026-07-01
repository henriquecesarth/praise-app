@echo off
echo Iniciando o backend local...
set "PATH=%~dp0.node\node-v20.13.1-win-x64;%PATH%"
set "NODE_OPTIONS=--experimental-websocket"
cd backend
npm run dev
