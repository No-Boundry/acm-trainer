@echo off
rem ACM-Trainer 一键启动（开发模式）
cd /d "%~dp0"
echo 正在启动 ACM-Trainer（开发模式）...
echo 若首次运行请先执行 install.bat 安装依赖
call npm.cmd run dev
pause
