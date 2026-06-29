@echo off
echo Iniciando o servidor web local...
set "PATH=%~dp0.node\node-v20.13.1-win-x64;%PATH%"
cd web
npm run dev
