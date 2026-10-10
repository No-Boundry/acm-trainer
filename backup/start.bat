@echo off
rem ACM 训练模式启动脚本
cd /d "%~dp0"
echo 正在启动 ACM 训练模式...
echo 启动后请用浏览器打开 http://127.0.0.1:4000
start "" http://127.0.0.1:4000
node server.js
pause
